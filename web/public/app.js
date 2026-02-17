/**
 * Code Wiki - Frontend Application
 */

// State
let wikiIndex = null;
let currentPage = 'search';
let currentCategory = null;
let currentDocument = null;
let currentUser = null;
let editingDocument = null;
let isDirty = false;

// DOM Elements
const app = document.getElementById('app');
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchResults = document.getElementById('search-results');
const filterCategory = document.getElementById('filter-category');
const filterLanguage = document.getElementById('filter-language');
const categoriesContainer = document.getElementById('categories-container');
const categoryContent = document.getElementById('category-content');
const reposContainer = document.getElementById('repos-container');
const repoStatusFilter = document.getElementById('repo-status-filter');
const repoSearch = document.getElementById('repo-search');

// Category icons
const categoryIcons = {
  patterns: '🏗️',
  utilities: '🔧',
  integrations: '🔌',
  templates: '📄',
  snippets: '✂️',
  projects: '📁',
  root: '📚',
};

// Initialize
async function init() {
  await loadIndex();
  await checkAuth();
  setupEventListeners();
  setupEditor();
  handleNavigation();
}

// Load the wiki index
async function loadIndex() {
  try {
    const response = await fetch('/data/index.json');
    if (!response.ok) throw new Error('Failed to load index');
    wikiIndex = await response.json();
    populateFilters();
  } catch (error) {
    console.error('Error loading index:', error);
    // Try loading from API if static file not available
    try {
      const apiResponse = await fetch('/api/index');
      if (apiResponse.ok) {
        wikiIndex = await apiResponse.json();
        populateFilters();
      }
    } catch (apiError) {
      console.error('Error loading from API:', apiError);
    }
  }
}

// Populate filter dropdowns
function populateFilters() {
  if (!wikiIndex) return;

  // Categories
  filterCategory.innerHTML = '<option value="">All Categories</option>';
  wikiIndex.categories.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
    filterCategory.appendChild(option);
  });

  // Languages
  const languages = new Set();
  wikiIndex.documents.forEach(doc => {
    if (doc.language) languages.add(doc.language);
  });
  wikiIndex.repos.forEach(repo => {
    repo.languages.forEach(lang => languages.add(lang));
  });

  filterLanguage.innerHTML = '<option value="">All Languages</option>';
  Array.from(languages).sort().forEach(lang => {
    const option = document.createElement('option');
    option.value = lang;
    option.textContent = lang.charAt(0).toUpperCase() + lang.slice(1);
    filterLanguage.appendChild(option);
  });
}

// Setup event listeners
function setupEventListeners() {
  // Navigation
  document.querySelectorAll('[data-page]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = e.target.dataset.page;
      navigateTo(page);
    });
  });

  // Search
  searchBtn.addEventListener('click', performSearch);
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
  });

  // Filters
  filterCategory.addEventListener('change', performSearch);
  filterLanguage.addEventListener('change', performSearch);

  // Include repo files toggle
  const includeRepoFilesToggle = document.getElementById('include-repo-files');
  if (includeRepoFilesToggle) {
    includeRepoFilesToggle.addEventListener('change', performSearch);
  }

  // Repo filters
  repoStatusFilter.addEventListener('change', renderRepos);
  repoSearch.addEventListener('input', renderRepos);

  // Repo view tabs
  document.querySelectorAll('.repo-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchRepoTab(tabName);
    });
  });

  // Browser navigation
  window.addEventListener('popstate', handleNavigation);
}

// Navigate to a page
function navigateTo(page, params = {}) {
  let url = '/' + (page === 'search' ? '' : page);
  if (params.doc) url += '?doc=' + encodeURIComponent(params.doc);
  if (params.category) url += '?category=' + encodeURIComponent(params.category);

  history.pushState({ page, ...params }, '', url);
  showPage(page, params);
}

// Handle browser navigation
function handleNavigation() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);

  let page = 'search';
  if (path === '/browse' || path.startsWith('/browse')) page = 'browse';
  else if (path === '/repos' || path.startsWith('/repos')) page = 'repos';
  else if (path === '/login') page = 'login';
  else if (path === '/editor' || path.startsWith('/editor')) page = 'editor';
  else if (path === '/document' || params.get('doc')) page = 'document';

  const pageParams = {};
  if (params.get('doc')) pageParams.doc = params.get('doc');
  if (params.get('category')) pageParams.category = params.get('category');

  showPage(page, pageParams);
}

// Show a specific page
function showPage(page, params = {}) {
  currentPage = page;

  // Update nav
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  // Show target page
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) {
    pageEl.classList.add('active');
  }

  // Page-specific actions
  switch (page) {
    case 'search':
      loadQuickView();
      break;
    case 'browse':
      renderCategories();
      renderRepos();
      loadRepoFilesView();
      loadRepoListView();
      if (params.category) {
        selectCategory(params.category);
      }
      break;
    case 'repos':
      // Redirect /repos to /browse
      navigateTo('browse');
      return;
    case 'document':
      if (params.doc) {
        showDocument(params.doc);
      }
      break;
    case 'editor':
      if (params.doc) {
        openEditor(params.doc);
      }
      break;
  }
}

// Perform search
function performSearch() {
  const query = searchInput.value.trim().toLowerCase();
  const category = filterCategory.value;
  const language = filterLanguage.value;
  const includeRepoFiles = document.getElementById('include-repo-files')?.checked ?? true;

  if (!query && !category && !language) {
    searchResults.innerHTML = '<p class="placeholder-text">Enter a search term to find wiki documents and code</p>';
    return;
  }

  if (!wikiIndex) {
    searchResults.innerHTML = '<p class="placeholder-text">Loading index...</p>';
    return;
  }

  const results = [];

  // Search documents
  wikiIndex.documents.forEach(doc => {
    if (category && doc.category !== category) return;
    if (language && doc.language !== language) return;

    let score = 0;
    const searchText = `${doc.title} ${doc.description || ''} ${doc.tags.join(' ')} ${doc.content}`.toLowerCase();

    if (query) {
      if (doc.title.toLowerCase().includes(query)) score += 50;
      if (doc.tags.some(t => t.toLowerCase().includes(query))) score += 30;
      if (searchText.includes(query)) score += 10;
      if (score === 0) return;
    } else {
      score = 10; // Default score for filter-only results
    }

    results.push({
      type: 'wiki',
      title: doc.title,
      path: doc.relativePath,
      preview: doc.contentPreview,
      score,
      tags: doc.tags,
      language: doc.language,
    });
  });

  // Search repos
  wikiIndex.repos.forEach(repo => {
    if (language && !repo.languages.includes(language)) return;

    let score = 0;
    const searchText = `${repo.name} ${repo.description || ''} ${repo.languages.join(' ')}`.toLowerCase();

    if (query) {
      if (repo.name.toLowerCase().includes(query)) score += 50;
      if (searchText.includes(query)) score += 10;
      if (score === 0) return;
    } else {
      score = 5; // Default score for filter-only results
    }

    results.push({
      type: 'repo',
      title: repo.name,
      path: repo.githubUrl || '',
      preview: repo.description || 'No description',
      score,
      tags: repo.languages,
      repoName: repo.name,
    });
  });

  // Search repo files (if toggle is on)
  if (includeRepoFiles && query) {
    wikiIndex.repos.forEach(repo => {
      if (!repo.markdownFiles || !repo.githubUrl) return;
      if (language && !repo.languages.includes(language)) return;

      const githubBaseUrl = repo.githubUrl.replace(/\.git$/, '');

      repo.markdownFiles.forEach(file => {
        let score = 0;
        const searchText = `${file.relativePath} ${file.name}`.toLowerCase();

        if (file.name.toLowerCase().includes(query)) score += 40;
        else if (searchText.includes(query)) score += 15;

        if (score > 0) {
          const fileType = file.fileType || 'md';
          const icon = getFileTypeIcon(fileType);
          results.push({
            type: 'repo-file',
            title: `${icon} ${file.relativePath}`,
            path: `${githubBaseUrl}/edit/main/${file.relativePath}`,
            preview: `${repo.name} - ${file.name}`,
            score,
            tags: repo.languages,
            repoName: repo.name,
            fileType,
          });
        }
      });
    });
  }

  // Sort by score
  results.sort((a, b) => b.score - a.score);

  // Render results
  renderSearchResults(results.slice(0, 50));
}

// Get display label for result type
function getResultTypeLabel(type) {
  switch (type) {
    case 'wiki': return 'wiki';
    case 'repo': return 'repo';
    case 'repo-file': return 'file';
    default: return type;
  }
}

// Render search results
function renderSearchResults(results) {
  if (results.length === 0) {
    searchResults.innerHTML = '<p class="placeholder-text">No results found</p>';
    return;
  }

  searchResults.innerHTML = results.map(result => `
    <div class="result-item" data-type="${result.type}" data-path="${escapeHtml(result.path)}">
      <div class="result-header">
        <span class="result-title">${escapeHtml(result.title)}</span>
        <span class="result-type ${result.type}">${getResultTypeLabel(result.type)}</span>
      </div>
      <p class="result-preview">${escapeHtml(result.preview)}</p>
      <div class="result-meta">
        ${result.tags && result.tags.length > 0 ? `
          <div class="result-tags">
            ${result.tags.slice(0, 5).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');

  // Add click handlers
  searchResults.querySelectorAll('.result-item').forEach(item => {
    item.addEventListener('click', () => {
      const type = item.dataset.type;
      const path = item.dataset.path;

      if (type === 'wiki') {
        navigateTo('document', { doc: path });
      } else if ((type === 'repo' || type === 'repo-file') && path.startsWith('http')) {
        window.open(path, '_blank');
      }
    });
  });
}

// Render categories
function renderCategories() {
  if (!wikiIndex) {
    categoriesContainer.innerHTML = '<p class="loading">Loading</p>';
    return;
  }

  const categoryCounts = {};
  wikiIndex.documents.forEach(doc => {
    categoryCounts[doc.category] = (categoryCounts[doc.category] || 0) + 1;
  });

  categoriesContainer.innerHTML = wikiIndex.categories.map(cat => `
    <div class="category-card" data-category="${cat}">
      <div class="category-icon">${categoryIcons[cat] || '📁'}</div>
      <div class="category-name">${cat}</div>
      <div class="category-count">${categoryCounts[cat] || 0} documents</div>
    </div>
  `).join('');

  // Add click handlers
  categoriesContainer.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => {
      selectCategory(card.dataset.category);
    });
  });
}

// Select a category
function selectCategory(category) {
  currentCategory = category;

  // Update active state
  categoriesContainer.querySelectorAll('.category-card').forEach(card => {
    card.classList.toggle('active', card.dataset.category === category);
  });

  // Show category documents
  if (!wikiIndex) return;

  const docs = wikiIndex.documents.filter(d => d.category === category);

  if (docs.length === 0) {
    categoryContent.innerHTML = '<p class="placeholder-text">No documents in this category</p>';
    return;
  }

  categoryContent.innerHTML = `
    <h3>${category.charAt(0).toUpperCase() + category.slice(1)}</h3>
    <ul class="doc-list">
      ${docs.map(doc => `
        <li class="doc-list-item" data-path="${doc.relativePath}">
          <div class="doc-list-title">${escapeHtml(doc.title)}</div>
          ${doc.description ? `<div class="doc-list-desc">${escapeHtml(doc.description)}</div>` : ''}
        </li>
      `).join('')}
    </ul>
  `;

  // Add click handlers
  categoryContent.querySelectorAll('.doc-list-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo('document', { doc: item.dataset.path });
    });
  });
}

// Render repos
function renderRepos() {
  if (!wikiIndex) {
    reposContainer.innerHTML = '<p class="loading">Loading</p>';
    return;
  }

  const statusFilter = repoStatusFilter.value;
  const searchQuery = repoSearch.value.toLowerCase();

  let repos = wikiIndex.repos;

  if (statusFilter) {
    repos = repos.filter(r => r.status === statusFilter);
  }

  if (searchQuery) {
    repos = repos.filter(r =>
      r.name.toLowerCase().includes(searchQuery) ||
      (r.description && r.description.toLowerCase().includes(searchQuery))
    );
  }

  if (repos.length === 0) {
    reposContainer.innerHTML = '<p class="placeholder-text">No repositories found</p>';
    return;
  }

  reposContainer.innerHTML = repos.map(repo => `
    <div class="repo-card">
      <div class="repo-header">
        <div class="repo-name">
          ${repo.githubUrl ? `<a href="${repo.githubUrl}" target="_blank">${escapeHtml(repo.name)}</a>` : escapeHtml(repo.name)}
        </div>
        <span class="repo-status ${repo.status}">${repo.status.replace('-', ' ')}</span>
      </div>
      ${repo.description ? `<p class="repo-description">${escapeHtml(repo.description)}</p>` : ''}
      ${repo.languages.length > 0 ? `
        <div class="repo-languages">
          ${repo.languages.slice(0, 5).map(lang => `<span class="repo-lang">${escapeHtml(lang)}</span>`).join('')}
        </div>
      ` : ''}
    </div>
  `).join('');
}

// Switch between repo view tabs
function switchRepoTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.repo-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  // Update view visibility
  document.querySelectorAll('.repo-view').forEach(view => {
    view.classList.remove('active');
  });

  const activeView = document.getElementById(`repo-${tabName}-view`);
  if (activeView) {
    activeView.classList.add('active');
  }
}

// Load repository list view content from repo-locations.md
function loadRepoListView() {
  const container = document.getElementById('repo-list-content');
  if (!container) return;

  // Find the repo-locations document in the index
  const doc = wikiIndex?.documents.find(d => d.relativePath === 'projects/repo-locations.md');

  if (doc) {
    container.innerHTML = renderMarkdown(doc.content);
  } else {
    container.innerHTML = '<p class="placeholder-text">Repository index not found</p>';
  }
}

// Get icon for file type
function getFileTypeIcon(fileType) {
  const icons = {
    md: '📝',
    txt: '📄',
    rst: '📜',
    adoc: '📋',
    org: '📓'
  };
  return icons[fileType] || '📄';
}

// Load repository files view - shows repos alphabetically with their doc files
function loadRepoFilesView() {
  const container = document.getElementById('repo-files-content');
  if (!container) return;

  if (!wikiIndex || !wikiIndex.repos) {
    container.innerHTML = '<p class="placeholder-text">Loading repository data...</p>';
    return;
  }

  // Sort repos alphabetically
  const repos = [...wikiIndex.repos].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );

  // Filter to repos that have documentation files
  const reposWithDocFiles = repos.filter(repo =>
    repo.markdownFiles && repo.markdownFiles.length > 0
  );

  if (reposWithDocFiles.length === 0) {
    container.innerHTML = '<p class="placeholder-text">No documentation files found in repositories. Rebuild the index to scan for files.</p>';
    return;
  }

  // Build the HTML
  let html = '<div class="repo-files-list">';

  for (const repo of reposWithDocFiles) {
    const githubBaseUrl = repo.githubUrl ? repo.githubUrl.replace(/\.git$/, '') : null;

    html += `<div class="repo-files-item">`;
    html += `<div class="repo-files-header">`;
    if (githubBaseUrl) {
      html += `<a href="${githubBaseUrl}" target="_blank" class="repo-files-name">${escapeHtml(repo.name)}</a>`;
    } else {
      html += `<span class="repo-files-name">${escapeHtml(repo.name)}</span>`;
    }
    html += `<span class="repo-files-count">${repo.markdownFiles.length} file${repo.markdownFiles.length !== 1 ? 's' : ''}</span>`;
    html += `</div>`;

    html += `<ul class="repo-doc-files">`;
    for (const file of repo.markdownFiles) {
      const fileType = file.fileType || 'md';
      const icon = getFileTypeIcon(fileType);
      if (githubBaseUrl) {
        const fileUrl = `${githubBaseUrl}/blob/main/${file.relativePath}`;
        html += `<li data-type="${fileType}"><span class="file-icon">${icon}</span><a href="${fileUrl}" target="_blank">${escapeHtml(file.relativePath)}</a></li>`;
      } else {
        html += `<li data-type="${fileType}"><span class="file-icon">${icon}</span>${escapeHtml(file.relativePath)}</li>`;
      }
    }
    html += `</ul>`;
    html += `</div>`;
  }

  html += '</div>';
  container.innerHTML = html;
}

// Show document
async function showDocument(docPath) {
  const documentTitle = document.getElementById('document-title');
  const documentMeta = document.getElementById('document-meta');
  const documentContent = document.getElementById('document-content');
  const backLink = document.getElementById('back-link');

  documentContent.innerHTML = '<p class="loading">Loading</p>';

  // Set back link
  backLink.onclick = (e) => {
    e.preventDefault();
    history.back();
  };

  // Find document in index
  if (!wikiIndex) {
    documentContent.innerHTML = '<p>Error: Index not loaded</p>';
    return;
  }

  const doc = wikiIndex.documents.find(d => d.relativePath === docPath);

  if (!doc) {
    documentTitle.textContent = 'Document Not Found';
    documentMeta.innerHTML = '';
    documentContent.innerHTML = '<p>The requested document could not be found.</p>';
    return;
  }

  currentDocument = doc;
  documentTitle.textContent = doc.title;

  // Meta info
  const metaParts = [];
  if (doc.category) metaParts.push(`Category: ${doc.category}`);
  if (doc.language) metaParts.push(`Language: ${doc.language}`);
  if (doc.updated) metaParts.push(`Updated: ${doc.updated}`);
  documentMeta.innerHTML = metaParts.join(' | ');

  // Render content (basic markdown to HTML)
  documentContent.innerHTML = renderMarkdown(doc.content);

  // Show edit button if logged in AND document is editable (not auto-generated)
  const editBtn = document.getElementById('edit-btn');
  if (editBtn) {
    const isAutoGenerated = doc.tags && doc.tags.includes('auto-generated');
    editBtn.style.display = currentUser && !isAutoGenerated ? 'inline-block' : 'none';
    editBtn.onclick = () => openEditor(docPath);
  }
}

// Basic markdown renderer
function renderMarkdown(text) {
  // This is a simple renderer - for production, use a library like marked.js

  // First, process tables before escaping HTML
  const lines = text.split('\n');
  const processedLines = [];
  let inTable = false;
  let tableLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if this is a table row (starts and ends with |, or is a separator row)
    const isTableRow = line.startsWith('|') && line.endsWith('|');
    const isSeparator = /^\|[\s\-:|]+\|$/.test(line);

    if (isTableRow || isSeparator) {
      if (!inTable) {
        inTable = true;
        tableLines = [];
      }
      tableLines.push(line);
    } else {
      if (inTable) {
        // End of table, process it
        processedLines.push(renderTable(tableLines));
        inTable = false;
        tableLines = [];
      }
      processedLines.push(lines[i]);
    }
  }

  // Handle table at end of content
  if (inTable && tableLines.length > 0) {
    processedLines.push(renderTable(tableLines));
  }

  let html = escapeHtml(processedLines.join('\n'));

  // Restore tables (they were marked with special tokens)
  html = html.replace(/\[TABLE_START\]/g, '<table>');
  html = html.replace(/\[TABLE_END\]/g, '</table>');
  html = html.replace(/\[THEAD_START\]/g, '<thead>');
  html = html.replace(/\[THEAD_END\]/g, '</thead>');
  html = html.replace(/\[TBODY_START\]/g, '<tbody>');
  html = html.replace(/\[TBODY_END\]/g, '</tbody>');
  html = html.replace(/\[TR_START\]/g, '<tr>');
  html = html.replace(/\[TR_END\]/g, '</tr>');
  html = html.replace(/\[TH_START\]/g, '<th>');
  html = html.replace(/\[TH_END\]/g, '</th>');
  html = html.replace(/\[TD_START\]/g, '<td>');
  html = html.replace(/\[TD_END\]/g, '</td>');

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Horizontal rules
  html = html.replace(/^---$/gim, '<hr>');

  // Lists
  html = html.replace(/^\- (.+)$/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';

  // Clean up
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[1-3]>)/g, '$1');
  html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre>)/g, '$1');
  html = html.replace(/(<\/pre>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<table>)/g, '$1');
  html = html.replace(/(<\/table>)<\/p>/g, '$1');
  html = html.replace(/<p>(<hr>)/g, '$1');
  html = html.replace(/(<hr>)<\/p>/g, '$1');

  return html;
}

// Render markdown table to HTML (with token placeholders to survive escaping)
function renderTable(lines) {
  if (lines.length < 2) return lines.join('\n');

  let result = '[TABLE_START]';
  let isHeader = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip separator rows (|---|---|)
    if (/^\|[\s\-:|]+\|$/.test(line)) {
      if (isHeader) {
        result += '[THEAD_END][TBODY_START]';
        isHeader = false;
      }
      continue;
    }

    // Parse cells
    const cells = line.split('|').slice(1, -1).map(c => c.trim());

    if (isHeader && i === 0) {
      result += '[THEAD_START]';
    }

    result += '[TR_START]';
    cells.forEach(cell => {
      if (isHeader && i === 0) {
        result += `[TH_START]${cell}[TH_END]`;
      } else {
        result += `[TD_START]${cell}[TD_END]`;
      }
    });
    result += '[TR_END]';
  }

  if (isHeader) {
    result += '[THEAD_END]';
  } else {
    result += '[TBODY_END]';
  }

  result += '[TABLE_END]';
  return result;
}

// Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// AUTH MODULE
// ============================================

// Check authentication status
async function checkAuth() {
  console.log('checkAuth: starting...');
  try {
    const response = await fetch('/.netlify/functions/user', {
      credentials: 'include',
    });
    console.log('checkAuth: response status', response.status);
    if (response.ok) {
      const data = await response.json();
      console.log('checkAuth: user data', data);
      currentUser = data.user;
    } else {
      const errorText = await response.text();
      console.log('checkAuth: not authenticated', errorText);
      currentUser = null;
    }
  } catch (err) {
    console.error('checkAuth: failed', err);
    currentUser = null;
  }
  console.log('checkAuth: currentUser =', currentUser);
  updateAuthUI();
}

// Update UI based on auth state
function updateAuthUI() {
  console.log('updateAuthUI: currentUser =', currentUser);
  const loginNavLink = document.getElementById('login-nav-link');
  const userNav = document.getElementById('user-nav');
  const userAvatar = document.getElementById('user-avatar');
  const userName = document.getElementById('user-name');
  const logoutBtn = document.getElementById('logout-btn');
  const editBtn = document.getElementById('edit-btn');

  console.log('updateAuthUI: elements found', { loginNavLink: !!loginNavLink, userNav: !!userNav });

  if (currentUser) {
    console.log('updateAuthUI: showing user nav for', currentUser.login);
    // Show user nav, hide login link
    if (loginNavLink) loginNavLink.style.display = 'none';
    if (userNav) {
      userNav.style.display = 'flex';
      if (userAvatar) userAvatar.src = currentUser.avatar_url || '';
      if (userName) userName.textContent = currentUser.name || currentUser.login;
    }
    if (logoutBtn) {
      logoutBtn.onclick = handleLogout;
    }
    // Show edit button on document page (unless auto-generated)
    if (editBtn && currentDocument) {
      const isAutoGenerated = currentDocument.tags && currentDocument.tags.includes('auto-generated');
      editBtn.style.display = isAutoGenerated ? 'none' : 'inline-block';
    }
  } else {
    // Show login link, hide user nav
    if (loginNavLink) loginNavLink.style.display = 'inline';
    if (userNav) userNav.style.display = 'none';
    if (editBtn) editBtn.style.display = 'none';
  }
}

// Handle login - redirect to GitHub OAuth
function handleLogin() {
  window.location.href = '/.netlify/functions/oauth-login';
}

// Handle logout
async function handleLogout() {
  try {
    await fetch('/.netlify/functions/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'logout' }),
    });
  } catch (err) {
    console.error('Logout error:', err);
  }

  currentUser = null;
  updateAuthUI();
  navigateTo('search');
}

// ============================================
// EDITOR MODULE
// ============================================

// Setup editor event listeners
function setupEditor() {
  // GitHub login button on login page
  const githubLoginBtn = document.getElementById('github-login-btn');
  if (githubLoginBtn) {
    githubLoginBtn.addEventListener('click', handleLogin);
  }

  // New document button and modal
  const newDocBtn = document.getElementById('new-doc-btn');
  const newDocModal = document.getElementById('new-doc-modal');
  const newDocCancel = document.getElementById('new-doc-cancel');
  const newDocCreate = document.getElementById('new-doc-create');
  const modalBackdrop = newDocModal?.querySelector('.modal-backdrop');

  if (newDocBtn) {
    newDocBtn.addEventListener('click', () => {
      if (newDocModal) {
        newDocModal.style.display = 'flex';
        document.getElementById('new-doc-filename').value = '';
        document.getElementById('new-doc-filename').focus();
      }
    });
  }

  if (newDocCancel) {
    newDocCancel.addEventListener('click', closeNewDocModal);
  }

  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', closeNewDocModal);
  }

  if (newDocCreate) {
    newDocCreate.addEventListener('click', createNewDocument);
  }

  // Enter key in filename field
  const filenameInput = document.getElementById('new-doc-filename');
  if (filenameInput) {
    filenameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') createNewDocument();
    });
  }

  // Preview toggle
  const previewToggle = document.getElementById('editor-preview-toggle');
  const editorMain = document.querySelector('.editor-main');
  const previewPane = document.getElementById('preview-pane');

  if (previewToggle) {
    previewToggle.addEventListener('click', () => {
      if (editorMain) editorMain.classList.toggle('split-view');
      if (previewPane) {
        previewPane.classList.toggle('hidden');
        previewToggle.textContent = previewPane.classList.contains('hidden')
          ? 'Preview'
          : 'Hide Preview';
        if (!previewPane.classList.contains('hidden')) {
          updatePreview();
        }
      }
    });
  }

  // Content change -> update preview
  const contentArea = document.getElementById('editor-content');
  if (contentArea) {
    contentArea.addEventListener('input', () => {
      isDirty = true;
      const previewPane = document.getElementById('preview-pane');
      if (previewPane && !previewPane.classList.contains('hidden')) {
        updatePreview();
      }
    });

    // Keyboard shortcuts
    contentArea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveDocument();
      }
    });
  }

  // Save button
  const saveBtn = document.getElementById('editor-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveDocument);
  }

  // Toolbar actions
  document.querySelectorAll('.editor-toolbar button').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action) applyToolbarAction(action);
    });
  });

  // Back link
  const backLink = document.getElementById('editor-back-link');
  if (backLink) {
    backLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (isDirty && !confirm('You have unsaved changes. Discard?')) {
        return;
      }
      isDirty = false;
      history.back();
    });
  }

  // Warn before leaving with unsaved changes
  window.addEventListener('beforeunload', (e) => {
    if (isDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// Close new document modal
function closeNewDocModal() {
  const modal = document.getElementById('new-doc-modal');
  if (modal) modal.style.display = 'none';
}

// Create new document from modal
function createNewDocument() {
  const category = document.getElementById('new-doc-category').value;
  const filename = document.getElementById('new-doc-filename').value.trim();

  if (!filename) {
    alert('Please enter a filename');
    return;
  }

  // Sanitize filename (alphanumeric, hyphens, underscores only)
  const sanitized = filename
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!sanitized) {
    alert('Invalid filename');
    return;
  }

  closeNewDocModal();

  // Open editor for new document
  openEditorForNew(category, sanitized);
}

// Open editor for a new document
function openEditorForNew(category, filename) {
  if (!currentUser) {
    navigateTo('login');
    return;
  }

  const relativePath = `${category}/${filename}.md`;

  // Create a temporary document object for new doc
  editingDocument = {
    relativePath,
    category,
    title: '',
    description: '',
    tags: [],
    language: '',
    content: '',
    isNew: true,
  };
  isDirty = false;

  // Clear editor fields
  document.getElementById('edit-title').value = '';
  document.getElementById('edit-description').value = '';
  document.getElementById('edit-tags').value = '';
  document.getElementById('edit-language').value = '';
  document.getElementById('editor-content').value = '';
  document.getElementById('commit-message').value = `Add ${filename}`;

  // Update title
  document.getElementById('editor-title').textContent = `New Document: ${category}/${filename}.md`;

  // Clear status
  const status = document.getElementById('editor-status');
  if (status) {
    status.className = 'editor-status';
    status.textContent = '';
  }

  // Reset preview
  const previewPane = document.getElementById('preview-pane');
  if (previewPane) previewPane.classList.add('hidden');
  const previewToggle = document.getElementById('editor-preview-toggle');
  if (previewToggle) previewToggle.textContent = 'Preview';

  // Navigate to editor
  navigateTo('editor', { doc: relativePath });
}

// Open editor for a document
function openEditor(docPath) {
  if (!currentUser) {
    navigateTo('login');
    return;
  }

  // Find document in index
  const doc = wikiIndex?.documents.find(d => d.relativePath === docPath);
  if (!doc) {
    // Check if this might be a new document being created
    if (editingDocument?.relativePath === docPath && editingDocument?.isNew) {
      // Already set up for new document, just show editor
      return;
    }
    alert('Document not found');
    return;
  }

  editingDocument = doc;
  isDirty = false;

  // Populate editor fields
  document.getElementById('edit-title').value = doc.title || '';
  document.getElementById('edit-description').value = doc.description || '';
  document.getElementById('edit-tags').value = (doc.tags || []).join(', ');
  document.getElementById('edit-language').value = doc.language || '';
  document.getElementById('editor-content').value = extractContentBody(doc.content);
  document.getElementById('commit-message').value = `Update ${doc.title}`;

  // Update title
  document.getElementById('editor-title').textContent = `Edit: ${doc.title}`;

  // Clear status
  const status = document.getElementById('editor-status');
  if (status) {
    status.className = 'editor-status';
    status.textContent = '';
  }

  // Reset preview
  const previewPane = document.getElementById('preview-pane');
  if (previewPane) previewPane.classList.add('hidden');
  const previewToggle = document.getElementById('editor-preview-toggle');
  if (previewToggle) previewToggle.textContent = 'Preview';

  // Navigate to editor
  navigateTo('editor', { doc: docPath });
}

// Extract content body (without frontmatter)
function extractContentBody(content) {
  if (!content) return '';
  // If content starts with ---, extract body after second ---
  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      return content.slice(endIndex + 3).trim();
    }
  }
  return content;
}

// Build frontmatter from form fields
function buildFrontmatter() {
  const title = document.getElementById('edit-title').value.trim();
  const description = document.getElementById('edit-description').value.trim();
  const tags = document.getElementById('edit-tags').value
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
  const language = document.getElementById('edit-language').value;

  // Build YAML frontmatter
  let yaml = '---\n';
  yaml += `title: "${title}"\n`;
  if (description) yaml += `description: "${description}"\n`;
  if (tags.length > 0) yaml += `tags: [${tags.map(t => `"${t}"`).join(', ')}]\n`;
  if (language) yaml += `language: "${language}"\n`;
  yaml += `updated: "${new Date().toISOString().split('T')[0]}"\n`;
  yaml += '---\n\n';

  return yaml;
}

// Build full document content
function buildDocumentContent() {
  const frontmatter = buildFrontmatter();
  const body = document.getElementById('editor-content').value;
  return frontmatter + body;
}

// Update preview
function updatePreview() {
  const content = document.getElementById('editor-content').value;
  const preview = document.getElementById('editor-preview');
  if (preview) {
    preview.innerHTML = renderMarkdown(content);
  }
}

// Save document
async function saveDocument() {
  if (!currentUser || !editingDocument) {
    alert('Please log in to save changes');
    return;
  }

  const saveBtn = document.getElementById('editor-save');
  const status = document.getElementById('editor-status');

  // Validate
  const title = document.getElementById('edit-title').value.trim();
  if (!title) {
    showEditorStatus('error', 'Title is required');
    return;
  }

  const commitMessage = document.getElementById('commit-message').value.trim();
  if (!commitMessage) {
    showEditorStatus('error', 'Commit message is required');
    return;
  }

  // Build content
  const content = buildDocumentContent();

  // Disable save button
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  showEditorStatus('loading', 'Committing changes to GitHub...');

  try {
    const response = await fetch('/.netlify/functions/save-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        path: editingDocument.relativePath,
        content,
        commitMessage,
        isNew: editingDocument.isNew || false,
      }),
    });

    const result = await response.json();

    if (response.ok && result.success) {
      isDirty = false;
      const isNew = editingDocument.isNew;
      showEditorStatus('success', `${isNew ? 'Created' : 'Saved'}! Commit: ${result.commit.sha.slice(0, 7)}`);

      // Update local index
      editingDocument.content = content;
      editingDocument.title = title;
      editingDocument.description = document.getElementById('edit-description').value.trim();
      editingDocument.updated = new Date().toISOString().split('T')[0];

      // Add to index if new
      if (isNew && wikiIndex) {
        editingDocument.isNew = false;
        editingDocument.contentPreview = content.slice(0, 200);
        wikiIndex.documents.push(editingDocument);
      }

      // Redirect back to document view after short delay
      setTimeout(() => {
        navigateTo('document', { doc: editingDocument.relativePath });
      }, 1500);
    } else {
      showEditorStatus('error', result.error || 'Failed to save');
    }
  } catch (err) {
    console.error('Save error:', err);
    showEditorStatus('error', 'Network error. Please try again.');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & Commit';
    }
  }
}

// Show editor status message
function showEditorStatus(type, message) {
  const status = document.getElementById('editor-status');
  if (status) {
    status.className = `editor-status ${type}`;
    status.textContent = message;
  }
}

// Toolbar actions for markdown formatting
function applyToolbarAction(action) {
  const textarea = document.getElementById('editor-content');
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.substring(start, end);

  let replacement = '';
  let cursorOffset = 0;

  switch (action) {
    case 'bold':
      replacement = `**${selected || 'bold text'}**`;
      cursorOffset = selected ? 0 : -2;
      break;
    case 'italic':
      replacement = `*${selected || 'italic text'}*`;
      cursorOffset = selected ? 0 : -1;
      break;
    case 'code':
      replacement = `\`${selected || 'code'}\``;
      cursorOffset = selected ? 0 : -1;
      break;
    case 'link':
      replacement = `[${selected || 'link text'}](url)`;
      cursorOffset = -1;
      break;
    case 'heading':
      replacement = `## ${selected || 'Heading'}`;
      break;
    case 'list':
      replacement = `- ${selected || 'List item'}`;
      break;
    case 'codeblock':
      replacement = `\`\`\`\n${selected || 'code here'}\n\`\`\``;
      cursorOffset = selected ? 0 : -4;
      break;
    default:
      return;
  }

  textarea.value =
    textarea.value.substring(0, start) +
    replacement +
    textarea.value.substring(end);

  textarea.focus();
  const newPos = start + replacement.length + cursorOffset;
  textarea.setSelectionRange(newPos, newPos);

  isDirty = true;
  updatePreview();
}

// Quick View - Deployment table with Netlify integration
let netlifySites = null;

async function loadQuickView() {
  // Quick View table on search page only
  const searchBody = document.getElementById('search-quickview-tbody');

  if (!wikiIndex) return;
  if (!searchBody) return;

  // Show loading state
  const loadingHtml = '<tr><td colspan="3" class="loading">Loading deployment data...</td></tr>';
  searchBody.innerHTML = loadingHtml;

  // Fetch Netlify sites if not already loaded
  if (!netlifySites) {
    try {
      const response = await fetch('/.netlify/functions/netlify-sites');
      const data = await response.json();
      if (data.success && data.data?.sites) {
        netlifySites = data.data.sites;
      } else {
        netlifySites = [];
        console.warn('Could not load Netlify sites:', data.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Error fetching Netlify sites:', error);
      netlifySites = [];
    }
  }

  // Build a map of GitHub URLs to Netlify sites
  const netlifyByRepoUrl = new Map();
  netlifySites.forEach(site => {
    if (site.repoUrl) {
      // Normalize the repo URL (remove .git suffix, etc.)
      const normalizedUrl = site.repoUrl.replace(/\.git$/, '').toLowerCase();
      netlifyByRepoUrl.set(normalizedUrl, site);
    }
  });

  // Build repo data with Netlify info
  const repoData = wikiIndex.repos.map(repo => {
    const githubUrl = repo.githubUrl?.replace(/\.git$/, '') || '';
    const normalizedGithub = githubUrl.toLowerCase();
    const netlifySite = netlifyByRepoUrl.get(normalizedGithub);
    return { repo, githubUrl, netlifySite };
  });

  // Sort: deployed repos first (alphabetically), then non-deployed (alphabetically)
  repoData.sort((a, b) => {
    const aDeployed = !!a.netlifySite;
    const bDeployed = !!b.netlifySite;
    if (aDeployed !== bDeployed) {
      return bDeployed - aDeployed; // Deployed first
    }
    return a.repo.name.localeCompare(b.repo.name); // Alphabetical within group
  });

  // Find the index where non-deployed repos start
  const firstNonDeployedIndex = repoData.findIndex(({ netlifySite }) => !netlifySite);
  const hasDeployed = firstNonDeployedIndex !== 0;
  const hasNonDeployed = firstNonDeployedIndex !== -1;

  // Render the table with separator row
  const rows = [];
  repoData.forEach(({ repo, githubUrl, netlifySite }, index) => {
    // Add separator row before first non-deployed repo (if there are deployed repos before it)
    if (hasDeployed && hasNonDeployed && index === firstNonDeployedIndex) {
      rows.push(`
        <tr class="separator-row">
          <td></td>
          <td>Unstaged</td>
          <td></td>
        </tr>
      `);
    }

    // GitHub link
    const githubLink = githubUrl
      ? `<a href="${escapeHtml(githubUrl)}" target="_blank" title="View on GitHub">${escapeHtml(repo.name)}</a>`
      : escapeHtml(repo.name);

    // Staging link - show URL without https://
    let stagingCell = '<span class="no-deploy">-</span>';
    if (netlifySite) {
      const displayUrl = netlifySite.url.replace(/^https?:\/\//, '');
      stagingCell = `<a href="${escapeHtml(netlifySite.url)}" target="_blank" class="netlify-link" title="View live site">${escapeHtml(displayUrl)}</a>`;
    }

    // Notes - with edit button if logged in
    const notesContent = renderNotesCell(repo.name, repo.notes || '');

    rows.push(`
      <tr>
        <td>${githubLink}</td>
        <td>${stagingCell}</td>
        <td class="notes-cell">${notesContent}</td>
      </tr>
    `);
  });

  const rowsHtml = rows.join('');

  const finalHtml = rowsHtml || '<tr><td colspan="3" class="placeholder-text">No repositories found</td></tr>';
  searchBody.innerHTML = finalHtml;
}

// ============================================
// EDITABLE NOTES MODULE
// ============================================

// Render notes cell with edit capability
function renderNotesCell(repoName, noteText) {
  const escapedRepoName = escapeHtml(repoName);
  const escapedNote = escapeHtml(noteText);

  if (currentUser) {
    // Logged in - show editable notes (clickable, styled with color)
    return `
      <div class="notes-content" data-repo="${escapedRepoName}" onclick="startEditNote('${escapedRepoName}', '${escapedNote.replace(/'/g, "\\'")}')">
        <span class="notes-text">${noteText ? escapedNote : '<span class="no-notes">-</span>'}</span>
      </div>
    `;
  } else {
    // Not logged in - read-only notes
    return noteText ? escapedNote : '<span class="no-notes">-</span>';
  }
}

// Start editing a note
function startEditNote(repoName, currentNote) {
  // Find all notes cells for this repo (might be in multiple tables)
  const notesContents = document.querySelectorAll(`.notes-content[data-repo="${repoName}"]`);

  notesContents.forEach(container => {
    container.innerHTML = `
      <div class="notes-edit-form">
        <input type="text" class="notes-edit-input" value="${escapeHtml(currentNote)}" placeholder="Add a note...">
        <button class="notes-save-btn" onclick="saveNote('${escapeHtml(repoName)}')">Save</button>
        <button class="notes-cancel-btn" onclick="cancelEditNote('${escapeHtml(repoName)}', '${escapeHtml(currentNote).replace(/'/g, "\\'")}')">Cancel</button>
      </div>
    `;

    // Focus input and handle Enter key
    const input = container.querySelector('.notes-edit-input');
    if (input) {
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          saveNote(repoName);
        } else if (e.key === 'Escape') {
          cancelEditNote(repoName, currentNote);
        }
      });
    }
  });
}

// Cancel editing a note
function cancelEditNote(repoName, originalNote) {
  const notesContents = document.querySelectorAll(`.notes-content[data-repo="${repoName}"]`);

  notesContents.forEach(container => {
    container.innerHTML = `
      <span class="notes-text">${originalNote ? escapeHtml(originalNote) : '<span class="no-notes">-</span>'}</span>
    `;
    container.onclick = () => startEditNote(repoName, originalNote);
  });
}

// Save a note
async function saveNote(repoName) {
  const notesContents = document.querySelectorAll(`.notes-content[data-repo="${repoName}"]`);
  if (notesContents.length === 0) return;

  // Get the new note value from the first input found
  const input = notesContents[0].querySelector('.notes-edit-input');
  if (!input) return;

  const newNote = input.value.trim();

  // Show saving state in all matching cells
  notesContents.forEach(container => {
    container.innerHTML = '<span class="notes-saving">Saving...</span>';
  });

  try {
    const response = await fetch('/.netlify/functions/save-note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        repoName: repoName,
        note: newNote,
      }),
    });

    const result = await response.json();

    if (response.ok && result.success) {
      // Update local index
      if (wikiIndex) {
        const repo = wikiIndex.repos.find(r => r.name === repoName);
        if (repo) {
          repo.notes = newNote;
        }
      }

      // Update UI with new value
      notesContents.forEach(container => {
        container.innerHTML = `
          <span class="notes-text">${newNote ? escapeHtml(newNote) : '<span class="no-notes">-</span>'}</span>
        `;
        container.onclick = () => startEditNote(repoName, newNote);
      });
    } else {
      // Show error and restore edit state
      alert(result.error || 'Failed to save note');
      startEditNote(repoName, newNote);
    }
  } catch (err) {
    console.error('Error saving note:', err);
    alert('Network error. Please try again.');
    startEditNote(repoName, newNote);
  }
}

// Make functions available globally for onclick handlers
window.startEditNote = startEditNote;
window.cancelEditNote = cancelEditNote;
window.saveNote = saveNote;

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
