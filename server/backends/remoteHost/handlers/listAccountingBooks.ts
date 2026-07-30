// listAccountingBooks command handler.
//
// { id, name } per accounting book, for a mobile book picker.
import { listBooks } from "@mulmoclaude/accounting-plugin/server";
import { toJsonObject, type CommandHandlers } from "@mulmoclaude/core/remote-host";

export const createListAccountingBooks =
  (workspace: string): CommandHandlers["listAccountingBooks"] =>
  async () => {
    const { books } = await listBooks(workspace);
    return toJsonObject({ books: books.map((book) => ({ id: book.id, name: book.name })) });
  };
