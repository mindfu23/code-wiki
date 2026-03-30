/**
 * get_project_flow tool implementation
 * Returns architecture/data flow diagram for a given project.
 */

import { WikiService } from '../services/wikiService.js';

export const getProjectFlowTool = {
  name: 'get_project_flow',
  description: 'Get the architecture and data flow diagram for a project. Returns a Mermaid flowchart showing how data moves through the app (user → frontend → APIs → services → response). Use this to understand a project\'s architecture before working on it.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      project: {
        type: 'string',
        description: 'Project name or partial match (e.g., "metabot", "datastic", "code-wiki")',
      },
    },
    required: ['project'],
  },
};

export async function handleGetProjectFlow(
  args: { project: string },
  wikiService: WikiService
): Promise<string> {
  const query = args.project.toLowerCase();

  // Search diagram documents in the wiki
  const allDocs = await wikiService.getDocumentsByCategory('diagrams');

  // Find matching diagram by title, source_repo, or filename
  const matches = allDocs.filter(doc => {
    const title = (doc.frontmatter.title || '').toLowerCase();
    const sourceRepo = (doc.frontmatter.source_repo || '').toLowerCase();
    const filename = doc.relativePath.toLowerCase();
    return title.includes(query) || sourceRepo.includes(query) || filename.includes(query);
  });

  if (matches.length === 0) {
    // List available diagrams
    const available = allDocs.map(d => ({
      title: d.frontmatter.title,
      sourceRepo: d.frontmatter.source_repo,
      path: d.relativePath,
    }));

    return JSON.stringify({
      error: `No flow diagram found for "${args.project}"`,
      availableDiagrams: available,
      suggestion: 'Try one of the available project names, or create a new diagram in wiki/diagrams/',
    }, null, 2);
  }

  // Load full content for the best match
  const match = matches[0];
  const fullDoc = await wikiService.getDocument(match.relativePath);

  if (!fullDoc) {
    return JSON.stringify({
      error: `Found diagram "${match.frontmatter.title}" but could not read its content`,
      path: match.relativePath,
    }, null, 2);
  }

  return JSON.stringify({
    project: match.frontmatter.source_repo || match.frontmatter.title,
    title: match.frontmatter.title,
    description: match.frontmatter.description,
    tags: match.frontmatter.tags,
    language: match.frontmatter.language,
    content: fullDoc.content,
    path: match.relativePath,
  }, null, 2);
}
