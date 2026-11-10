//! Bounded, read-only spreadsheet projection. Cell contents remain inert data.

use std::{
    borrow::Cow,
    collections::VecDeque,
    mem::size_of,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{error::ApiError, file_extraction};

pub(crate) const XLSX_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_SHEETS: usize = 100;
const MAX_ROWS: usize = 1_048_576;
const MAX_COLUMNS: usize = 16_384;
const MAX_CELLS: usize = 50_000;
const MAX_MERGES: usize = 2_000;
const MAX_RANGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_CACHE_BYTES: usize = 48 * 1024 * 1024;
const MAX_CACHE_ENTRIES: usize = 8;

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum Visibility {
    Visible,
    Hidden,
    VeryHidden,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
enum DateSystem {
    #[serde(rename = "1900")]
    Excel1900,
    #[serde(rename = "1904")]
    Excel1904,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum Format {
    Csv,
    Xlsx,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Rectangle {
    pub row_start: usize,
    pub row_count: usize,
    pub column_start: usize,
    pub column_count: usize,
}

impl Rectangle {
    pub(crate) fn validate_request(self) -> Result<(), ApiError> {
        if self.row_count == 0
            || self.row_count > 200
            || self.column_count == 0
            || self.column_count > 100
            || self.row_count * self.column_count > 5_000
            || self.row_start >= MAX_ROWS
            || self.column_start >= MAX_COLUMNS
        {
            return Err(ApiError::BadRequest(
                "Spreadsheet range is out of bounds".into(),
            ));
        }
        Ok(())
    }

    fn intersects(self, other: Self) -> bool {
        self.row_count != 0
            && self.column_count != 0
            && other.row_count != 0
            && other.column_count != 0
            && self.row_start < other.row_start + other.row_count
            && other.row_start < self.row_start + self.row_count
            && self.column_start < other.column_start + other.column_count
            && other.column_start < self.column_start + self.column_count
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SheetMetadata {
    id: String,
    name: String,
    visibility: Visibility,
    row_count: usize,
    column_count: usize,
    merges: Vec<Rectangle>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum CellKind {
    Text,
    Number,
    Boolean,
    Error,
    Date,
    Blank,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum FormulaStatus {
    Cached,
    Missing,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum FormatStatus {
    Raw,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Cell {
    #[serde(flatten)]
    position: Position,
    kind: CellKind,
    value: Value,
    display_value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    number_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    number_format_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    format_status: Option<FormatStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    formula: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    formula_status: Option<FormulaStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    formula_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    formula_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    formula_shared_index: Option<String>,
}

impl Cell {
    fn csv(row: usize, column: usize, text: &str) -> Self {
        Self {
            position: Position { row, column },
            kind: CellKind::Text,
            value: Value::String(text.into()),
            display_value: text.into(),
            number_format: None,
            number_format_id: None,
            format_status: None,
            formula: None,
            formula_status: None,
            formula_type: None,
            formula_ref: None,
            formula_shared_index: None,
        }
    }

    fn weight(&self) -> usize {
        size_of::<Self>()
            + self.display_value.capacity()
            + self.value.as_str().map_or(0, str::len)
            + [
                &self.number_format,
                &self.formula,
                &self.formula_type,
                &self.formula_ref,
                &self.formula_shared_index,
            ]
            .into_iter()
            .filter_map(|field| field.as_ref())
            .map(String::capacity)
            .sum::<usize>()
    }

    fn valid(&self) -> bool {
        match self.kind {
            CellKind::Text | CellKind::Error => self.value.is_string(),
            CellKind::Date => self.value.is_number() || self.value.is_string(),
            CellKind::Number => self.value.is_number(),
            CellKind::Boolean => self.value.is_boolean(),
            CellKind::Blank => self.value.is_null(),
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) struct Position {
    pub row: usize,
    pub column: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtractedSheet {
    #[serde(flatten)]
    metadata: SheetMetadata,
    cells: Vec<Cell>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ExtractedSpreadsheet {
    sheets: Vec<ExtractedSheet>,
    date_system: DateSystem,
    pub source_sha256: String,
    pub policy_version: String,
}

impl ExtractedSpreadsheet {
    pub(crate) fn validate(&self) -> Result<(), ApiError> {
        let mut cells = 0;
        let mut merges = 0;
        let valid = !self.sheets.is_empty()
            && self.sheets.len() <= MAX_SHEETS
            && self.sheets.iter().enumerate().all(|(index, sheet)| {
                cells += sheet.cells.len();
                merges += sheet.metadata.merges.len();
                let metadata = &sheet.metadata;
                metadata.id == index.to_string()
                    && !metadata.name.is_empty()
                    && metadata.name.len() <= 255
                    && metadata.row_count <= MAX_ROWS
                    && metadata.column_count <= MAX_COLUMNS
                    && cells <= MAX_CELLS
                    && merges <= MAX_MERGES
                    && metadata.merges.iter().all(|range| {
                        range.row_count > 0
                            && range.column_count > 0
                            && range.row_start < metadata.row_count
                            && range.column_start < metadata.column_count
                            && range.row_count <= metadata.row_count - range.row_start
                            && range.column_count <= metadata.column_count - range.column_start
                    })
                    && sheet.cells.iter().all(|cell| {
                        cell.position.row < metadata.row_count
                            && cell.position.column < metadata.column_count
                            && cell.valid()
                    })
                    && sheet
                        .cells
                        .windows(2)
                        .all(|pair| pair[0].position < pair[1].position)
            });
        if !valid {
            return Err(ApiError::Unavailable(
                "Workbook inspection returned invalid sheet data".into(),
            ));
        }
        Ok(())
    }
}

pub(crate) struct Workbook {
    format: Format,
    date_system: Option<DateSystem>,
    sheets: Vec<Sheet>,
}

pub(crate) struct Sheet {
    metadata: SheetMetadata,
    cells: SheetCells,
}

enum SheetCells {
    Csv(Vec<Vec<String>>),
    Xlsx(Vec<Cell>),
}

impl Workbook {
    pub(crate) async fn read(content_type: &str, bytes: Vec<u8>) -> Result<Self, ApiError> {
        match content_type {
            XLSX_CONTENT_TYPE => Ok(file_extraction::inspect_xlsx_viewer(&bytes).await?.into()),
            "text/csv" | "application/csv" => {
                tokio::task::spawn_blocking(move || Self::csv(&bytes))
                    .await
                    .map_err(ApiError::internal)?
            }
            _ => Err(ApiError::UnsupportedMediaType(
                "File is not a supported spreadsheet".into(),
            )),
        }
    }

    fn csv(bytes: &[u8]) -> Result<Self, ApiError> {
        let records = lumiere_file_inspection::inspect_document_csv(bytes)
            .map_err(|error| ApiError::Unprocessable(error.to_string()))?
            .records;
        Ok(Self::from_csv_records(records))
    }

    pub(crate) fn read_csv_selection(
        bytes: &[u8],
        encoding: &str,
        delimiter: char,
    ) -> Result<Self, ApiError> {
        let records =
            lumiere_file_inspection::parse_document_csv_with_options(bytes, encoding, delimiter)
                .map_err(|error| ApiError::Unprocessable(error.to_string()))?;
        Ok(Self::from_csv_records(records))
    }

    fn from_csv_records(records: Vec<Vec<String>>) -> Self {
        Self {
            format: Format::Csv,
            date_system: None,
            sheets: vec![Sheet {
                metadata: SheetMetadata {
                    id: "0".into(),
                    name: "CSV".into(),
                    visibility: Visibility::Visible,
                    row_count: records.len(),
                    column_count: records.iter().map(Vec::len).max().unwrap_or(0),
                    merges: vec![],
                },
                cells: SheetCells::Csv(records),
            }],
        }
    }

    pub(crate) fn sheet_named(&self, name: &str) -> Result<&Sheet, ApiError> {
        let mut matching = self
            .sheets
            .iter()
            .filter(|sheet| sheet.metadata.name == name);
        let sheet = matching
            .next()
            .ok_or_else(|| ApiError::NotFound("Spreadsheet sheet not found".into()))?;
        if matching.next().is_some() {
            return Err(ApiError::Conflict(
                "Spreadsheet sheet name is ambiguous".into(),
            ));
        }
        Ok(sheet)
    }

    pub(crate) fn metadata<'a>(&'a self, source: &'a Source) -> impl Serialize + 'a {
        Metadata {
            source,
            format: self.format,
            date_system: self.date_system,
            sheets: self.sheets.iter().map(|sheet| &sheet.metadata).collect(),
        }
    }

    pub(crate) fn sheet(&self, id: &str) -> Result<&Sheet, ApiError> {
        self.sheets
            .iter()
            .find(|sheet| sheet.metadata.id == id)
            .ok_or_else(|| ApiError::NotFound("Spreadsheet sheet not found".into()))
    }

    fn weight(&self) -> usize {
        self.sheets
            .iter()
            .map(|sheet| {
                size_of::<Sheet>()
                    + sheet.metadata.name.capacity()
                    + sheet.metadata.merges.capacity() * size_of::<Rectangle>()
                    + match &sheet.cells {
                        SheetCells::Csv(rows) => {
                            rows.capacity() * size_of::<Vec<String>>()
                                + rows
                                    .iter()
                                    .map(|row| {
                                        row.capacity() * size_of::<String>()
                                            + row.iter().map(String::capacity).sum::<usize>()
                                    })
                                    .sum::<usize>()
                        }
                        SheetCells::Xlsx(cells) => cells.iter().map(Cell::weight).sum(),
                    }
            })
            .sum()
    }
}

impl From<ExtractedSpreadsheet> for Workbook {
    fn from(workbook: ExtractedSpreadsheet) -> Self {
        Self {
            format: Format::Xlsx,
            date_system: Some(workbook.date_system),
            sheets: workbook
                .sheets
                .into_iter()
                .map(|sheet| Sheet {
                    metadata: sheet.metadata,
                    cells: SheetCells::Xlsx(sheet.cells),
                })
                .collect(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Source {
    pub document_id: String,
    pub version_id: String,
    pub checksum: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Metadata<'a> {
    #[serde(flatten)]
    source: &'a Source,
    format: Format,
    #[serde(skip_serializing_if = "Option::is_none")]
    date_system: Option<DateSystem>,
    sheets: Vec<&'a SheetMetadata>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Range<'a> {
    #[serde(flatten)]
    source: &'a Source,
    sheet_id: &'a str,
    #[serde(flatten)]
    rectangle: Rectangle,
    cells: Vec<Cow<'a, Cell>>,
    merges: Vec<&'a Rectangle>,
}

impl Range<'_> {
    pub(crate) fn assistant_cells(&self, requested: Rectangle) -> Result<Vec<Value>, ApiError> {
        if self.rectangle.row_count != requested.row_count
            || self.rectangle.column_count != requested.column_count
        {
            return Err(ApiError::BadRequest(
                "The selected range is outside the worksheet".into(),
            ));
        }
        let mut cells = Vec::new();
        let mut bytes = 0usize;
        for cell in &self.cells {
            // The visible cached display value is evidence. Formula expressions
            // themselves are never sent to the assistant.
            let value = &cell.display_value;
            if lumiere_file_inspection::has_prompt_injection(value)
                || lumiere_file_inspection::is_formula_injection(value)
            {
                return Err(ApiError::Unprocessable(
                    "Selected cells require manual review before AI assistance".into(),
                ));
            }
            bytes += value.len();
            if bytes > 8192 {
                return Err(ApiError::BadRequest(
                    "Select fewer cells for the assistant".into(),
                ));
            }
            cells.push(serde_json::json!({
                "row": cell.position.row + 1,
                "column": cell.position.column + 1,
                "value": value,
                "cachedFormulaValue": cell.formula_status.is_some_and(|status| matches!(status, FormulaStatus::Cached)),
            }));
        }
        Ok(cells)
    }
}

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Direction {
    #[default]
    Next,
    Previous,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Search<'a> {
    #[serde(flatten)]
    source: &'a Source,
    #[serde(rename = "match")]
    position: Option<Position>,
    wrapped: bool,
}

impl Sheet {
    pub(crate) fn range<'a>(&'a self, source: &'a Source, requested: Rectangle) -> Range<'a> {
        let rectangle = Rectangle {
            row_count: requested
                .row_count
                .min(self.metadata.row_count.saturating_sub(requested.row_start)),
            column_count: requested.column_count.min(
                self.metadata
                    .column_count
                    .saturating_sub(requested.column_start),
            ),
            ..requested
        };
        let row_end = rectangle.row_start + rectangle.row_count;
        let column_end = rectangle.column_start + rectangle.column_count;
        let cells = match &self.cells {
            SheetCells::Csv(rows) => rows
                .iter()
                .enumerate()
                .skip(rectangle.row_start)
                .take(rectangle.row_count)
                .flat_map(|(row, values)| {
                    values
                        .iter()
                        .enumerate()
                        .skip(rectangle.column_start)
                        .take(rectangle.column_count)
                        .filter(|(_, text)| !text.is_empty())
                        .map(move |(column, text)| Cow::Owned(Cell::csv(row, column, text)))
                })
                .collect(),
            SheetCells::Xlsx(cells) => {
                let start = cells.partition_point(|cell| cell.position.row < rectangle.row_start);
                cells[start..]
                    .iter()
                    .take_while(|cell| cell.position.row < row_end)
                    .filter(|cell| {
                        (rectangle.column_start..column_end).contains(&cell.position.column)
                    })
                    .map(Cow::Borrowed)
                    .collect()
            }
        };
        Range {
            source,
            sheet_id: &self.metadata.id,
            rectangle,
            cells,
            merges: self
                .metadata
                .merges
                .iter()
                .filter(|merge| merge.intersects(rectangle))
                .collect(),
        }
    }

    pub(crate) fn search<'a>(
        &self,
        source: &'a Source,
        query: &str,
        cursor: Option<Position>,
        direction: Direction,
    ) -> Search<'a> {
        let query = query.to_lowercase();
        let mut first = None;
        let mut next = None;
        let better = |candidate, previous: Option<Position>| match direction {
            Direction::Next => previous.is_none_or(|position| candidate < position),
            Direction::Previous => previous.is_none_or(|position| candidate > position),
        };
        let mut visit = |position, display: &str, formula: Option<&str>| {
            if !display.to_lowercase().contains(&query)
                && !formula.is_some_and(|formula| formula.to_lowercase().contains(&query))
            {
                return;
            }
            if better(position, first) {
                first = Some(position);
            }
            let after_cursor = cursor.is_none_or(|cursor| match direction {
                Direction::Next => position > cursor,
                Direction::Previous => position < cursor,
            });
            if after_cursor && better(position, next) {
                next = Some(position);
            }
        };
        match &self.cells {
            SheetCells::Csv(rows) => {
                for (row, values) in rows.iter().enumerate() {
                    for (column, value) in values.iter().enumerate() {
                        visit(Position { row, column }, value, None);
                    }
                }
            }
            SheetCells::Xlsx(cells) => {
                for cell in cells {
                    visit(cell.position, &cell.display_value, cell.formula.as_deref());
                }
            }
        }
        Search {
            source,
            position: next.or(first),
            wrapped: next.is_none() && first.is_some(),
        }
    }
}

impl Range<'_> {
    pub(crate) fn to_bytes(&self) -> Result<Option<Vec<u8>>, ApiError> {
        let data = serde_json::to_vec(self).map_err(ApiError::internal)?;
        Ok((data.len() <= MAX_RANGE_BYTES).then_some(data))
    }
}

#[derive(PartialEq, Eq)]
pub(crate) struct CacheKey {
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub document_id: u64,
    pub version_id: u64,
    pub object_key: String,
    pub checksum: String,
    pub content_type: String,
}

struct CacheEntry {
    key: CacheKey,
    weight: usize,
    workbook: Arc<Workbook>,
}

static CACHE: Mutex<VecDeque<CacheEntry>> = Mutex::new(VecDeque::new());

/// Call after current document, version and storage metadata authorization.
pub(crate) fn cached(key: &CacheKey) -> Option<Arc<Workbook>> {
    let mut cache = CACHE.lock().ok()?;
    let index = cache.iter().position(|entry| &entry.key == key)?;
    let entry = cache.remove(index)?;
    let workbook = Arc::clone(&entry.workbook);
    cache.push_back(entry);
    Some(workbook)
}

pub(crate) fn cache(key: CacheKey, workbook: Arc<Workbook>) {
    let weight = workbook.weight();
    if weight > MAX_CACHE_BYTES {
        return;
    }
    if let Ok(mut cache) = CACHE.lock() {
        cache.retain(|entry| entry.key != key);
        let mut total = cache.iter().map(|entry| entry.weight).sum::<usize>();
        while total + weight > MAX_CACHE_BYTES || cache.len() >= MAX_CACHE_ENTRIES {
            if let Some(entry) = cache.pop_front() {
                total -= entry.weight;
            }
        }
        cache.push_back(CacheEntry {
            key,
            weight,
            workbook,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn source() -> Source {
        Source {
            document_id: "9007199254740993".into(),
            version_id: "21".into(),
            checksum: "a".repeat(64),
        }
    }

    #[test]
    fn spreadsheet_csv_preserves_record_coordinates_and_search_wrap() {
        let workbook = Workbook::csv(b"ID,Notes\n\n0007,\"line\nwith Data\"\n0008,DATA\n").unwrap();
        let source = source();
        let metadata = serde_json::to_value(workbook.metadata(&source)).unwrap();
        assert_eq!(metadata["format"], "csv");
        assert_eq!(metadata["documentId"], "9007199254740993");
        assert_eq!(metadata["sheets"][0]["rowCount"], 4);

        let sheet = workbook.sheet("0").unwrap();
        let range = sheet.range(
            &source,
            Rectangle {
                row_start: 1,
                row_count: 20,
                column_start: 1,
                column_count: 5,
            },
        );
        let range: Value = serde_json::from_slice(&range.to_bytes().unwrap().unwrap()).unwrap();
        assert_eq!(range["rowCount"], 3);
        assert_eq!(range["columnCount"], 1);
        assert_eq!(range["cells"][0]["row"], 2);
        assert_eq!(range["cells"][0]["value"], "line\nwith Data");
        let first = sheet.search(&source, "data", None, Direction::Next);
        assert_eq!(first.position, Some(Position { row: 2, column: 1 }));
        let last = sheet.search(&source, "DATA", None, Direction::Previous);
        assert_eq!(last.position, Some(Position { row: 3, column: 1 }));
        let wrapped = sheet.search(&source, "DaTa", last.position, Direction::Next);
        assert_eq!(wrapped.position, first.position);
        assert!(wrapped.wrapped);
    }

    #[test]
    fn spreadsheet_wire_shape_preserves_cached_formulas_and_intersecting_merges() {
        let worker_result = json!({
            "policyVersion": "xlsx-viewer-seccomp-v1",
            "sourceSha256": "a".repeat(64),
            "dateSystem": "1904",
            "sheets": [{
                "id": "0",
                "name": "Ledger",
                "visibility": "visible",
                "rowCount": 100_001,
                "columnCount": 6,
                "merges": [{"rowStart": 99_998, "rowCount": 3, "columnStart": 1, "columnCount": 3}],
                "cells": [{
                    "row": 100_000, "column": 5, "value": 0.5, "displayValue": "50%",
                    "kind": "number", "numberFormat": "0%", "numberFormatId": 9,
                    "formula": "=A1/2", "formulaStatus": "cached",
                }],
            }]
        });
        let extracted: ExtractedSpreadsheet =
            serde_json::from_value(worker_result.clone()).unwrap();
        extracted.validate().unwrap();
        let workbook: Workbook = extracted.into();
        let source = source();
        let metadata = serde_json::to_value(workbook.metadata(&source)).unwrap();
        assert_eq!(metadata["dateSystem"], "1904");
        assert!(metadata["sheets"][0].get("cells").is_none());

        let sheet = workbook.sheet("0").unwrap();
        let range = sheet.range(
            &source,
            Rectangle {
                row_start: 100_000,
                row_count: 1,
                column_start: 3,
                column_count: 3,
            },
        );
        let range = serde_json::to_value(range).unwrap();
        assert_eq!(range["cells"][0]["formula"], "=A1/2");
        assert_eq!(range["cells"][0]["displayValue"], "50%");
        assert_eq!(range["cells"][0]["numberFormatId"], 9);
        assert_eq!(range["merges"][0]["rowStart"], 99_998);
        assert_eq!(range["merges"][0]["rowCount"], 3);
        assert!(sheet
            .search(&source, "A1/2", None, Direction::Next)
            .position
            .is_some());

        let mut malformed = worker_result;
        malformed["sheets"][0]["cells"][0]["row"] = json!(100_001);
        let malformed: ExtractedSpreadsheet = serde_json::from_value(malformed).unwrap();
        assert!(malformed.validate().is_err());
    }

    #[test]
    fn spreadsheet_range_rejects_zero_or_oversized_requests() {
        let rect = Rectangle {
            row_start: 0,
            row_count: 200,
            column_start: 0,
            column_count: 25,
        };
        assert!(rect.validate_request().is_ok());
        assert!(Rectangle {
            column_count: 26,
            ..rect
        }
        .validate_request()
        .is_err());
        assert!(Rectangle {
            row_count: 0,
            ..rect
        }
        .validate_request()
        .is_err());
        assert!(Rectangle {
            row_start: usize::MAX,
            ..rect
        }
        .validate_request()
        .is_err());
    }

    #[test]
    fn spreadsheet_cache_keys_bind_source_to_scope_version_and_checksum() {
        let key = || CacheKey {
            organization_id: 202,
            company_id: Some(5),
            document_id: 501,
            version_id: 3,
            object_key: "org-202/default/source".into(),
            checksum: "a".repeat(64),
            content_type: "text/csv".into(),
        };
        cache(key(), Arc::new(Workbook::csv(b"ID\n001\n").unwrap()));
        assert!(cached(&key()).is_some());
        for incorrect in [
            CacheKey {
                organization_id: 203,
                ..key()
            },
            CacheKey {
                company_id: Some(6),
                ..key()
            },
            CacheKey {
                document_id: 502,
                ..key()
            },
            CacheKey {
                version_id: 4,
                ..key()
            },
            CacheKey {
                checksum: "b".repeat(64),
                ..key()
            },
        ] {
            assert!(cached(&incorrect).is_none());
        }
    }
}
