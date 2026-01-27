/**
 * get_document tool implementation
 */

import { WikiService } from '../services/wikiService.js';

export const getDocumentTool = {
  name: 'get_document',
  description: 'Fetch a specific wiki document with parsed frontmatter and full content',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: "Path to the document relative to wiki root (e.g., 'patterns/api-client.md')",
      },
    },
    required: ['path'],
  },
};

export async function handleGetDocument(
  args: { path: string },
  wikiService: WikiService
): Promise<string> {
  const doc = await wikiService.getDocument(args.path);

  if (!doc) {
    return JSON.stringify({
      error: 'Document not found',
      path: args.path,
      suggestion: 'Use search_wiki or list_category to find available documents',
    }, null, 2);
  }

  return JSON.stringify({
    path: args.path,
    title: doc.frontmatter.title,
    tags: doc.frontmatter.tags,
    language: doc.frontmatter.language,
    updated: doc.frontmatter.updated,
    sourceRepo: doc.frontmatter.source_repo,
    description: doc.frontmatter.description,
    content: doc.content,
  }, null, 2);
}
