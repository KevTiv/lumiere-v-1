"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./pagination"

/** Rows per page for record tables across the app. */
export const TABLE_PAGE_SIZE = 25

export function paginationItems(currentPage: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const items: Array<number | "ellipsis"> = [1]
  if (currentPage > 3) items.push("ellipsis")

  const start = Math.max(2, currentPage - 1)
  const end = Math.min(totalPages - 1, currentPage + 1)
  for (let page = start; page <= end; page += 1) items.push(page)

  if (currentPage < totalPages - 2) items.push("ellipsis")
  items.push(totalPages)
  return items
}

/**
 * Client-side paging for an already filtered/sorted row list. The page resets
 * to 1 whenever `resetKey` changes (e.g. a search or filter value).
 */
export function usePagedRows<T>(rows: readonly T[], resetKey?: unknown, pageSize = TABLE_PAGE_SIZE) {
  const [page, setPage] = useState(1)
  useEffect(() => {
    setPage(1)
  }, [resetKey])

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return rows.slice(start, start + pageSize)
  }, [rows, currentPage, pageSize])

  return { pageRows, currentPage, totalPages, setPage, total: rows.length, pageSize }
}

interface TablePagerProps {
  currentPage: number
  totalPages: number
  setPage: (page: number) => void
  total: number
  pageSize: number
  /** Show the "1-25 of 80" range line under the controls. */
  showRange?: boolean
}

/** Page controls for a table; renders nothing when everything fits on one page. */
export function TablePager({
  currentPage,
  totalPages,
  setPage,
  total,
  pageSize,
  showRange = true,
}: TablePagerProps) {
  if (total <= pageSize) return null
  return (
    <div className="flex flex-col items-end gap-1 pt-2" data-testid="table-pager">
      <Pagination className="justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={(event) => {
                event.preventDefault()
                if (currentPage > 1) setPage(currentPage - 1)
              }}
              className={currentPage === 1 ? "pointer-events-none opacity-50" : undefined}
            />
          </PaginationItem>
          {paginationItems(currentPage, totalPages).map((item, index) =>
            item === "ellipsis" ? (
              <PaginationItem key={`ellipsis-${index}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={item}>
                <PaginationLink
                  href="#"
                  isActive={item === currentPage}
                  onClick={(event) => {
                    event.preventDefault()
                    setPage(item)
                  }}
                >
                  {item}
                </PaginationLink>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <PaginationNext
              href="#"
              onClick={(event) => {
                event.preventDefault()
                if (currentPage < totalPages) setPage(currentPage + 1)
              }}
              className={currentPage === totalPages ? "pointer-events-none opacity-50" : undefined}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
      {showRange ? (
        <p className="text-xs text-muted-foreground">
          {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, total)} of {total}
        </p>
      ) : null}
    </div>
  )
}
