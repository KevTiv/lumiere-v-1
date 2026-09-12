//! Printpdf rendering for line-oriented document exports.

use std::io::BufWriter;

use printpdf::{BuiltinFont, Mm, PdfDocument};

use crate::error::ApiError;

pub(crate) fn render_lines_pdf(title: &str, lines: &[String]) -> Result<Vec<u8>, ApiError> {
    let (doc, page1, layer1) = PdfDocument::new(title, Mm(210.0), Mm(297.0), "Layer 1");
    let font = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| ApiError::Internal(format!("add builtin font: {e}")))?;
    let layer = doc.get_page(page1).get_layer(layer1);

    layer.use_text(title, 16.0, Mm(15.0), Mm(280.0), &font);

    let mut y = 265.0;
    for line in lines {
        if y < 15.0 {
            break;
        }
        layer.use_text(line, 10.0, Mm(15.0), Mm(y), &font);
        y -= 6.0;
    }

    let mut buf = Vec::new();
    {
        let mut writer = BufWriter::new(&mut buf);
        doc.save(&mut writer)
            .map_err(|e| ApiError::Internal(format!("save pdf: {e}")))?;
    }
    Ok(buf)
}
