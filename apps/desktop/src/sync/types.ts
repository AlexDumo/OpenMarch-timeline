/**
 * The collaboration spike's wire types (docs/collaboration/spike/CONTRACT.md, "Op").
 *
 * `table` is the real SQLite table name and `id` is the row's rowid. Every synced table's primary
 * key is an `INTEGER PRIMARY KEY`, so the rowid is that key (`id`, `assignment_id` or `page_id`);
 * `row` and `prev` also carry the key column itself. Values are as SQLite returns them: numbers,
 * text and null. BLOB columns are left out of every image.
 */
export type RowValues = Record<string, unknown>;

export type RowChange =
    | { kind: "insert"; table: string; id: number; row: RowValues }
    | {
          kind: "update";
          table: string;
          id: number;
          set: RowValues;
          prev: RowValues;
      }
    | { kind: "delete"; table: string; id: number; prev: RowValues };

/** What one committed local edit hands the session: its label and its row changes. */
export interface LocalOp {
    /** `transactionWithHistory`'s funcName */
    label: string;
    changes: RowChange[];
}

/** A full copy of the synced tables: table name to its rows (images as in a `RowChange`). */
export type SyncSnapshot = Record<string, RowValues[]>;
