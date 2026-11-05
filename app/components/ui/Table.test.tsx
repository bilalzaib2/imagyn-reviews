// The house data table.
//
// Rendered to static markup with react-dom/server rather than driven in a DOM: everything
// asserted here is structural (what elements exist, what they contain, which attributes they
// carry), and none of it needs layout, focus or pointer events. The guarantees are the ones a
// shared primitive has to keep for every screen that adopts it, because a regression in any
// of them would show up as a subtly broken table on three pages at once.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Table, type TableColumn } from "./Table";

interface Row {
  id: string;
  name: string;
  count: number;
}

const ROWS: Row[] = [
  { id: "p1", name: "Coastal Linen Jacket", count: 12 },
  { id: "p2", name: "Harbour Wool Scarf", count: 3 },
];

const COLUMNS: TableColumn<Row>[] = [
  { key: "name", header: "Product", width: "60%", render: (row) => row.name },
  { key: "count", header: "Reviews", width: "40%", align: "end", numeric: true, render: (row) => row.count },
];

function render(ui: React.ReactElement): string {
  return renderToStaticMarkup(ui);
}

describe("Table", () => {
  it("renders one header cell per column and one row per record", () => {
    const html = render(<Table rows={ROWS} columns={COLUMNS} getRowKey={(row) => row.id} ariaLabel="Products" />);

    expect([...html.matchAll(/<th[\s>]/g)]).toHaveLength(2);
    expect([...html.matchAll(/<tr/g)]).toHaveLength(3); // one header row + two body rows
    expect(html).toContain("Coastal Linen Jacket");
    expect(html).toContain("Harbour Wool Scarf");
  });

  // An unlabelled data table is a wall of cells to a screen reader, which is why ariaLabel is
  // a required prop rather than an optional nicety.
  it("names itself for assistive technology", () => {
    const html = render(<Table rows={ROWS} columns={COLUMNS} getRowKey={(row) => row.id} ariaLabel="Synced products" />);
    expect(html).toContain('aria-label="Synced products"');
  });

  it("marks header cells as column scope", () => {
    const html = render(<Table rows={ROWS} columns={COLUMNS} getRowKey={(row) => row.id} ariaLabel="Products" />);
    expect([...html.matchAll(/scope="col"/g)]).toHaveLength(2);
  });

  // The layout is table-layout: fixed, which is only worth having with a complete plan — a
  // partial one produces exactly the arbitrary column widths it was adopted to avoid.
  //
  // Emitted as a custom property, not an inline `width`: an inline width cannot be overridden
  // by the narrow-viewport media query, which is what lets a table give the space freed by a
  // hideOnNarrow column to the columns that remain.
  it("applies each column's declared width to its header cell", () => {
    const html = render(<Table rows={ROWS} columns={COLUMNS} getRowKey={(row) => row.id} ariaLabel="Products" />);
    expect(html).toContain("--table-col-width:60%");
    expect(html).toContain("--table-col-width:40%");
  });

  it("renders a cell for every column on every row, in column order", () => {
    const html = render(<Table rows={[ROWS[0]]} columns={COLUMNS} getRowKey={(row) => row.id} ariaLabel="Products" />);
    expect(html.indexOf("Coastal Linen Jacket")).toBeLessThan(html.indexOf("12"));
  });

  it("renders arbitrary node cells, not just text", () => {
    const columns: TableColumn<Row>[] = [
      { key: "name", header: "Product", width: "100%", render: (row) => <a href={`/p/${row.id}`}>{row.name}</a> },
    ];
    const html = render(<Table rows={ROWS} columns={columns} getRowKey={(row) => row.id} ariaLabel="Products" />);
    expect(html).toContain('href="/p/p1"');
  });

  // The important one: a merchant with no data should see the screen's own empty state, not a
  // table head with nothing under it.
  it("renders the empty slot instead of an empty table", () => {
    const html = render(
      <Table
        rows={[]}
        columns={COLUMNS}
        getRowKey={(row) => row.id}
        ariaLabel="Products"
        empty={<p>No products synced yet</p>}
      />,
    );

    expect(html).toBe("<p>No products synced yet</p>");
    expect(html).not.toContain("<table");
  });

  // Documents the deliberate fallback rather than leaving it to be discovered: a caller that
  // forgets the slot still gets a valid, labelled table with its headers, which is recoverable,
  // instead of rendering nothing at all.
  it("falls back to a header-only table when no empty slot is supplied", () => {
    const html = render(<Table rows={[]} columns={COLUMNS} getRowKey={(row) => row.id} ariaLabel="Products" />);

    expect(html).toContain("<table");
    expect(html).toContain("Product");
    expect([...html.matchAll(/<tr/g)]).toHaveLength(1);
  });

  it("only constrains the scroll area when a caller caps the height", () => {
    const uncapped = render(<Table rows={ROWS} columns={COLUMNS} getRowKey={(row) => row.id} ariaLabel="Products" />);
    expect(uncapped).not.toContain("max-height");

    const capped = render(
      <Table rows={ROWS} columns={COLUMNS} getRowKey={(row) => row.id} ariaLabel="Products" maxHeight="40rem" />,
    );
    expect(capped).toContain("max-height:40rem");
    expect(capped).toContain("overflow:auto");
  });
});

describe("Table — selection", () => {
  const selection = (overrides: Partial<Parameters<typeof Table<Row>>[0]["selection"]> = {}) => ({
    selectedKeys: [] as readonly string[],
    onToggleRow: () => {},
    onToggleAll: () => {},
    rowLabel: (row: Row) => `Select ${row.name}`,
    allLabel: "Select all products on this page",
    ...overrides,
  });

  it("adds one checkbox column, with a header select-all", () => {
    const html = render(
      <Table rows={ROWS} columns={COLUMNS} getRowKey={(row) => row.id} ariaLabel="Products" selection={selection()} />,
    );

    // Two data columns plus the checkbox column.
    expect([...html.matchAll(/<th[\s>]/g)]).toHaveLength(3);
    expect([...html.matchAll(/type="checkbox"/g)]).toHaveLength(3); // header + two rows
    expect(html).toContain('aria-label="Select all products on this page"');
  });

  // A per-row label must name the row. "Select row 4" tells a screen-reader user nothing about
  // what they are about to approve or delete in bulk.
  it("names each row's checkbox after the row", () => {
    const html = render(
      <Table rows={ROWS} columns={COLUMNS} getRowKey={(row) => row.id} ariaLabel="Products" selection={selection()} />,
    );

    expect(html).toContain('aria-label="Select Coastal Linen Jacket"');
    expect(html).toContain('aria-label="Select Harbour Wool Scarf"');
  });

  it("reflects which rows are ticked", () => {
    const html = render(
      <Table
        rows={ROWS}
        columns={COLUMNS}
        getRowKey={(row) => row.id}
        ariaLabel="Products"
        selection={selection({ selectedKeys: ["p1"] })}
      />,
    );

    // Exactly one body checkbox is checked, and the header's select-all is not.
    expect([...html.matchAll(/checked=""/g)]).toHaveLength(1);
  });

  it("ticks the select-all only when every row is selected", () => {
    const all = render(
      <Table
        rows={ROWS}
        columns={COLUMNS}
        getRowKey={(row) => row.id}
        ariaLabel="Products"
        selection={selection({ selectedKeys: ["p1", "p2"] })}
      />,
    );
    expect([...all.matchAll(/checked=""/g)]).toHaveLength(3); // header + both rows
  });

  // A ticked select-all above zero rows is a control claiming something it cannot act on.
  it("never ticks the select-all on an empty page", () => {
    const html = render(
      <Table
        rows={[]}
        columns={COLUMNS}
        getRowKey={(row) => row.id}
        ariaLabel="Products"
        selection={selection({ selectedKeys: ["stale-id"] })}
      />,
    );

    expect(html).not.toContain('checked=""');
    expect(html).toContain("disabled=");
  });

  it("renders no checkbox column at all when selection is omitted", () => {
    const html = render(<Table rows={ROWS} columns={COLUMNS} getRowKey={(row) => row.id} ariaLabel="Products" />);
    expect(html).not.toContain('type="checkbox"');
    expect([...html.matchAll(/<th[\s>]/g)]).toHaveLength(2);
  });
});

describe("Table — master-detail rows", () => {
  it("makes rows focusable and clickable only when onActivateRow is given", () => {
    const plain = render(<Table rows={ROWS} columns={COLUMNS} getRowKey={(row) => row.id} ariaLabel="Products" />);
    expect(plain).not.toContain("tabindex");

    const activatable = render(
      <Table rows={ROWS} columns={COLUMNS} getRowKey={(row) => row.id} ariaLabel="Products" onActivateRow={() => {}} />,
    );
    expect([...activatable.matchAll(/tabindex="0"/g)]).toHaveLength(2);
  });

  // aria-current, not aria-selected: aria-selected is only meaningful on a row inside a
  // grid/treegrid, and these rows act as links into a detail panel.
  it("marks the open row with aria-current, and only that row", () => {
    const html = render(
      <Table
        rows={ROWS}
        columns={COLUMNS}
        getRowKey={(row) => row.id}
        ariaLabel="Products"
        onActivateRow={() => {}}
        activeRowKey="p2"
      />,
    );

    expect([...html.matchAll(/aria-current="true"/g)]).toHaveLength(1);
    expect(html).not.toContain("aria-selected");
  });

  it("marks nothing when no row is open", () => {
    const html = render(
      <Table
        rows={ROWS}
        columns={COLUMNS}
        getRowKey={(row) => row.id}
        ariaLabel="Products"
        onActivateRow={() => {}}
        activeRowKey={null}
      />,
    );

    expect(html).not.toContain("aria-current");
  });
});

describe("Table — narrow frames", () => {
  const WIDE: TableColumn<Row>[] = [
    { key: "name", header: "Product", width: "40%", widthNarrow: "70%", render: (row) => row.name },
    { key: "count", header: "Reviews", width: "30%", hideOnNarrow: true, render: (row) => row.count },
    { key: "extra", header: "Extra", width: "30%", render: () => "—" },
  ];

  it("emits a narrow width alongside the default one", () => {
    const html = render(<Table rows={ROWS} columns={WIDE} getRowKey={(row) => row.id} ariaLabel="Products" />);
    expect(html).toContain("--table-col-width:40%");
    expect(html).toContain("--table-col-width-narrow:70%");
  });

  // The part that is easy to get wrong per screen: hiding only the cells leaves the header row
  // one column longer than every body row, and a fixed-layout table then misaligns every
  // remaining column.
  it("marks the header AND the cells of a hidden column, so they drop together", () => {
    const html = render(<Table rows={[ROWS[0]]} columns={WIDE} getRowKey={(row) => row.id} ariaLabel="Products" />);
    const header = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));
    const body = html.slice(html.indexOf("<tbody"));

    // One marked cell in the header and one in the single body row.
    const marked = (fragment: string) => [...fragment.matchAll(/hideOnNarrow/g)].length;
    expect(marked(header)).toBe(1);
    expect(marked(body)).toBe(1);
  });
});

describe("Table — interactive cells", () => {
  const WITH_MENU: TableColumn<Row>[] = [
    { key: "name", header: "Product", width: "80%", render: (row) => row.name },
    {
      key: "actions",
      header: "Actions",
      headerHidden: true,
      width: "20%",
      interactive: true,
      render: () => <button type="button">Menu</button>,
    },
  ];

  it("hides an actions header visually while keeping it readable", () => {
    const html = render(<Table rows={ROWS} columns={WITH_MENU} getRowKey={(row) => row.id} ariaLabel="Products" />);

    // The text is still in the markup — a visually-hidden label, not a removed one.
    expect(html).toContain("Actions");
    expect(html).toContain("visuallyHidden");
  });

  it("still renders the column's controls", () => {
    const html = render(
      <Table
        rows={ROWS}
        columns={WITH_MENU}
        getRowKey={(row) => row.id}
        ariaLabel="Products"
        onActivateRow={() => {}}
      />,
    );

    expect([...html.matchAll(/<button/g)]).toHaveLength(2);
  });
});
