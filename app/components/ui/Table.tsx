// The house data table.
//
// WHY THIS EXISTS
//
// Before this, merchant data was rendered three different ways in the same product: Reviews
// and Requests each hand-rolled a near-identical custom table (app.reviews.module.css and
// app.requests.module.css, whose own comment reads "same convention as
// app.requests.module.css's .tableWrap/.table" — a comment is not a shared implementation),
// while Products rendered Polaris's DataTable, which brings its own type scale, row height,
// header treatment and hairline colour. Two tables in one app that disagree about what a
// column header looks like is the single most visible way a design system fails.
//
// This component is that convention, extracted verbatim rather than redesigned: the sticky
// header, the 12px uppercase column labels, the hairline rows, the hover fill and the
// scrollable wrapper are the ones Reviews and Requests already shared. Adopting it is
// therefore a consolidation, not a restyle.
//
// WHAT IT DOES AND DOES NOT DO
//
// It handles two behaviours, because two screens needed each of them and the markup for both
// is fiddly enough to get subtly wrong per screen:
//
//   `selection`     a checkbox column with a header select-all, for bulk actions.
//   `onActivateRow` master-detail: a clickable, focusable row that opens a detail panel.
//
// It still has NO sorting, NO pagination and NO row expansion. Each exists on at most one
// screen, against that screen's own URL state; pagination in particular belongs to the route,
// which owns the cursor. The rule is extract on the second caller, not the first.
//
// It owns no state. Which rows are ticked and which row is open both live in the screen, which
// is what lets Reviews drive the same selection from its bulk-action bar and its arrow-key
// navigation without this component knowing either exists.
//
// Cells are ReactNode, so a caller keeps full control of what a cell contains — the product
// cell on Products is a link wrapping an image and two lines of text, and no column
// configuration format would have expressed that better than a render function does.
import type { CSSProperties, ReactNode } from "react";

import styles from "./table.module.css";

export interface TableColumn<Row> {
  /** Stable identity for the column. Also the React key for every cell in it. */
  key: string;
  header: ReactNode;
  /**
   * A CSS width applied to the <th>. Supply one for every column or none at all: the layout
   * is `table-layout: fixed`, which needs a complete plan to be worth having, and a partial
   * one produces the arbitrary column widths it was adopted to avoid.
   *
   * Fixed layout rather than a min-width with horizontal scroll, because the alternative is
   * the status and actions columns sliding off-screen the moment a page puts the table beside
   * a detail panel.
   *
   * Emitted as a custom property rather than an inline `width`, so the narrow-viewport rules
   * below can override it — an inline width cannot be beaten by a media query.
   */
  width?: string;
  /**
   * The width this column takes once the table is narrow (≤640px), for redistributing the
   * space freed by `hideOnNarrow` columns.
   *
   * Optional. Without it, a fixed-layout table spreads the freed space proportionally across
   * the remaining columns, which is usually close enough — set this only where a screen wants
   * a specific column to absorb it.
   */
  widthNarrow?: string;
  /**
   * Drops this column entirely at ≤640px, header and cells together.
   *
   * For a wide queue on a narrow embedded frame, where truncating six columns is less useful
   * than showing three properly. It hides the <th> as well as the <td>, which is the part
   * that is easy to get wrong per screen: hiding only the cells leaves the header row a
   * column longer than every body row, and a fixed-layout table then misaligns every
   * remaining column.
   *
   * Only ever use it for data the merchant can still reach — on Requests, every dropped field
   * is in the detail panel for whichever row they open.
   */
  hideOnNarrow?: boolean;
  /**
   * Hides the header text visually while keeping it available to a screen reader.
   *
   * For a column of controls, where a visible "Actions" label is noise but an unnamed column
   * leaves a screen-reader user with no idea what the cell holds. A visually-hidden <th> is
   * the right pattern here rather than `aria-label` on the <th>, which several screen readers
   * ignore in favour of the cell's own text content — i.e. nothing.
   */
  headerHidden?: boolean;
  /** Right-align numeric and action columns. Numbers are additionally tabular-aligned. */
  align?: "start" | "end";
  /** Numeric columns get tabular figures, so digits line up down the column. */
  numeric?: boolean;
  /**
   * This cell contains its own controls (a menu button, a link, an input), so a click inside
   * it must not also activate the row.
   *
   * Only meaningful alongside `onActivateRow`. Implemented with stopPropagation rather than
   * preventDefault, so the control's own behaviour is untouched — the click simply does not
   * bubble up to the row's handler and open the detail panel behind the menu the merchant
   * just opened.
   */
  interactive?: boolean;
  render: (row: Row) => ReactNode;
}

/** A checkbox column with a header select-all. This component renders the checkboxes; the
 *  screen owns which keys are ticked. */
export interface TableSelection<Row> {
  selectedKeys: readonly string[];
  onToggleRow: (key: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  /** Per-row checkbox label. Must name the row — "Select row 4" tells a screen-reader user
   *  nothing about what they are about to act on in bulk. */
  rowLabel: (row: Row) => string;
  /** Header checkbox label, e.g. "Select all reviews on this page". */
  allLabel: string;
  disabled?: boolean;
}

interface TableProps<Row> {
  rows: readonly Row[];
  columns: readonly TableColumn<Row>[];
  getRowKey: (row: Row) => string;
  /** Names the table for assistive technology. Required — an unlabelled data table is a wall
   *  of cells to a screen reader. */
  ariaLabel: string;
  /** Rendered in place of the table when there are no rows. A caller that omits this gets an
   *  empty table body, which is almost never what a merchant should see — prefer EmptyState. */
  empty?: ReactNode;
  /** Caps the scroll area. Omitted lets the table grow with the page, which is right when the
   *  page itself paginates. */
  maxHeight?: string;
  /** Tighter rows, for a table shown beside a detail panel. */
  density?: "comfortable" | "compact";
  /** Adds a leading checkbox column. Omitted renders no checkbox column at all. */
  selection?: TableSelection<Row>;
  /**
   * Master-detail. When supplied, every row becomes clickable and focusable, and pressing
   * Enter or Space on a focused row activates it — so the list is operable without a mouse,
   * which matters on a moderation queue someone works through a hundred rows at a time.
   *
   * Keyboard navigation BETWEEN rows is deliberately not handled here: Reviews moves the
   * active row with ArrowUp/ArrowDown from a handler on its own list column, driven by its own
   * array index rather than by the DOM. That keeps arrowing and filtering consistent, and it
   * only works because this component owns no state.
   */
  onActivateRow?: (key: string) => void;
  /** Which row is currently open in the detail panel. */
  activeRowKey?: string | null;
}

/** Emits the column's widths as custom properties the stylesheet reads, so a media query can
 *  still override them — an inline `width` cannot be. Returns undefined when the column
 *  declares no width, leaving that column to the fixed layout's own distribution. */
function columnWidthStyle<Row>(column: TableColumn<Row>): CSSProperties | undefined {
  if (!column.width && !column.widthNarrow) return undefined;

  return {
    ...(column.width ? { "--table-col-width": column.width } : {}),
    ...(column.widthNarrow ? { "--table-col-width-narrow": column.widthNarrow } : {}),
  } as CSSProperties;
}

export function Table<Row>({
  rows,
  columns,
  getRowKey,
  ariaLabel,
  empty,
  maxHeight,
  density = "comfortable",
  selection,
  onActivateRow,
  activeRowKey = null,
}: TableProps<Row>) {
  if (rows.length === 0 && empty) {
    return <>{empty}</>;
  }

  const selectedKeys = selection ? new Set(selection.selectedKeys) : null;
  // "All selected" must be false on an empty page, not vacuously true — a ticked select-all
  // box above zero rows is a control claiming something it cannot act on.
  const allSelected =
    selection !== undefined && rows.length > 0 && rows.every((row) => selectedKeys!.has(getRowKey(row)));

  return (
    <div
      className={styles.wrap}
      // Only set when a caller asks for it, so the default is an uncapped table rather than
      // one with an arbitrary height baked in.
      style={maxHeight ? { maxHeight, overflow: "auto" } : undefined}
    >
      <table
        className={`${styles.table} ${density === "compact" ? styles.compact : ""}`}
        aria-label={ariaLabel}
      >
        <thead>
          <tr>
            {selection ? (
              <th scope="col" className={styles.checkboxCell}>
                <input
                  type="checkbox"
                  aria-label={selection.allLabel}
                  checked={allSelected}
                  onChange={(event) => selection.onToggleAll(event.target.checked)}
                  disabled={selection.disabled || rows.length === 0}
                />
              </th>
            ) : null}
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={columnWidthStyle(column)}
                className={[
                  column.align === "end" ? styles.alignEnd : "",
                  column.headerHidden ? styles.hiddenHeader : "",
                  column.hideOnNarrow ? styles.hideOnNarrow : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {column.headerHidden ? <span className={styles.visuallyHidden}>{column.header}</span> : column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = getRowKey(row);
            const isActive = activeRowKey !== null && key === activeRowKey;

            return (
              <tr
                key={key}
                className={[onActivateRow ? styles.rowActivatable : "", isActive ? styles.rowActive : ""]
                  .filter(Boolean)
                  .join(" ")}
                {...(onActivateRow
                  ? {
                      onClick: () => onActivateRow(key),
                      onKeyDown: (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          // Space would otherwise scroll the list out from under the row the
                          // merchant is trying to open.
                          event.preventDefault();
                          onActivateRow(key);
                        }
                      },
                      tabIndex: 0,
                      // aria-current, not aria-selected: aria-selected is only meaningful on a
                      // row inside a grid/treegrid, and this is a plain data table whose rows
                      // act as links into a detail panel. aria-current="true" is valid on any
                      // element and says exactly that — this is the one being shown.
                      "aria-current": isActive ? true : undefined,
                    }
                  : {})}
              >
                {selection ? (
                  // stopPropagation, not preventDefault: ticking a box for a bulk action must
                  // not also open that row in the detail panel, but the checkbox itself still
                  // needs its native toggle.
                  <td className={styles.checkboxCell} onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={selection.rowLabel(row)}
                      checked={selectedKeys!.has(key)}
                      onChange={(event) => selection.onToggleRow(key, event.target.checked)}
                      disabled={selection.disabled}
                    />
                  </td>
                ) : null}
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={[
                      column.align === "end" ? styles.alignEnd : "",
                      column.numeric ? styles.numeric : "",
                      column.hideOnNarrow ? styles.hideOnNarrow : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    {...(column.interactive && onActivateRow
                      ? { onClick: (event) => event.stopPropagation() }
                      : {})}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
