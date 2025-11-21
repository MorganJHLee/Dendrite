<div align="center">
  <img src="public/dendrite-logo.svg" alt="Dendrite Logo" width="120" height="120">

  # Dendrite

  **Connect your thoughts like neurons**

  A visual knowledge management application that helps you build and explore networks of interconnected ideas.

  ![License](https://img.shields.io/badge/license-MIT-blue.svg)
  ![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)

</div>

---

## 🧠 What is Dendrite?

Dendrite is a desktop application for visual knowledge management, inspired by how neurons communicate in the brain. Just as dendrites receive and integrate signals from other neurons, Dendrite helps you capture ideas and discover connections between them.

**Key Philosophy:**
- **Local-first**: Your data lives in simple markdown files you can access anywhere
- **Visual thinking**: See your knowledge as an interactive whiteboard and graph
- **Emergent structure**: Connections and insights emerge naturally from linked notes
- **Seamless integration**: Works with your existing markdown files and note-taking workflow

---

## ✨ Features

### 📝 Markdown-First Note Taking
- **File-based storage**: All notes are plain markdown files in folders you control
- **Frontmatter support**: Add metadata with YAML frontmatter
- **Wikilinks**: Connect notes with `[[Note Name]]` syntax
- **Bidirectional links**: Automatic backlink tracking
- **Real-time sync**: File watcher automatically updates when files change

### 🎨 Visual Whiteboard
- **Infinite canvas**: Drag and arrange note cards in 2D space
- **Card previews**: See titles, tags, and content at a glance
- **Sticky notes**: Quick annotations without creating full notes
- **Text boxes**: Add context and labels to your canvas
- **Card groups**: Color-coded collections for visual organization
- **Custom arrows**: Draw connections with labels
- **PDF integration**: Display PDF files and highlights as cards
- **Persistent layout**: Positions auto-save to `.whiteboard-metadata.json`
- **Pan & zoom**: Navigate large workspaces smoothly
- **Multiple whiteboards**: Create different canvases for different contexts

### 🕸️ Knowledge Graph
- **Global graph**: Visualize your entire knowledge base
- **Local graph**: Focus on connections around a specific note
- **Interactive**: Click, drag, zoom, and explore
- **Force-directed layout**: Automatic intelligent positioning
- **Real-time updates**: Graph reflects changes instantly
- **Visual clustering**: Related notes naturally group together

### 📄 PDF Workflow
- **Embedded PDF viewer**: Read PDFs directly in the app
- **Highlight cards**: Extract highlights as individual whiteboard cards
- **Visual arrangement**: Organize PDF insights on your canvas
- **Thumbnail previews**: Quick visual reference for PDF cards

### 🔍 Search & Discovery
- **Full-text search**: Find notes instantly
- **Dropdown suggestions**: Quick access to matching results
- **Tag filtering**: Browse notes by topic
- **File tree**: Navigate your folder structure
- **Backlink panel**: See what references each note

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** 16 or later
- **npm** or **yarn**
- **Git**

### Installation

```bash
# Clone the repository
git clone https://github.com/MorganJHLee/Dendrite.git
cd Dendrite

# Install dependencies
npm install

# Run in development mode
npm run electron:dev
```

### Building for Production

```bash
# Build the application
npm run electron:build

# Output will be in the dist/ directory
```

---

## 📖 Usage Guide

### Opening a Vault

1. Launch Dendrite
2. Click **"Open Vault"**
3. Select a folder containing your markdown files (or an empty folder to start fresh)
4. Your vault loads and displays in the whiteboard view

### Creating and Editing Notes

**From the Whiteboard:**
- Click **"Add Note"** to create a new markdown file
- Double-click a card to open the editor
- Use the built-in CodeMirror editor with markdown support

**From Your File System:**
- Create `.md` files directly in your vault folder
- Dendrite automatically detects and displays them

### Linking Notes

Use wikilink syntax to create connections:

```markdown
This note relates to [[Another Note]] and [[Project Ideas]].

You can link to headings: [[Research#Key Findings]]
```

### Adding Tags

Tags can appear anywhere in your content:

```markdown
# My Note

This discusses #productivity and #note-taking strategies.
```

### Using Frontmatter

Add structured metadata to notes:

```yaml
---
title: Custom Display Title
tags: [research, ai, machine-learning]
created: 2024-01-15
---

# Note content starts here
```

### Working with the Whiteboard

- **Move cards**: Drag cards to reposition them
- **Zoom**: Mouse wheel or trackpad pinch
- **Pan**: Click and drag the background
- **Select**: Click a card to see its backlinks
- **Add sticky note**: Quick annotations
- **Create arrows**: Connect related concepts visually
- **Group cards**: Select multiple cards and group them with colors

### Exploring the Graph

- **Switch views**: Use the floating button (grid icon = whiteboard, network icon = graph)
- **Global graph**: Shows all notes and connections
- **Local graph**: Click a note, then view graph to see nearby connections
- **Navigate**: Click nodes to select them, drag to reposition
- **Relayout**: Reorganize the graph automatically
- **Reset view**: Fit all nodes in viewport

---

## 🏗️ Architecture

### Technology Stack

**Frontend:**
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Zustand** - Lightweight state management
- **Konva.js** - High-performance canvas rendering
- **React-Konva** - React wrapper for Konva
- **Cytoscape.js** - Graph visualization with physics
- **CodeMirror 6** - Modern code/markdown editor
- **Lucide React** - Beautiful icon system
- **KaTeX** - Math notation rendering
- **Vite** - Fast build tool and dev server

**Backend:**
- **Electron 29** - Cross-platform desktop framework
- **Node.js** - JavaScript runtime
- **Chokidar** - Efficient file system watching
- **gray-matter** - Frontmatter parsing
- **markdown-it** - Markdown to HTML conversion
- **js-yaml** - YAML parsing
- **PDF.js** - PDF rendering and text extraction

### Project Structure

```
Dendrite/
├── electron/                      # Electron main process (backend)
│   ├── main.ts                    # App entry point, window management
│   ├── preload.ts                 # Secure IPC bridge
│   └── services/                  # Backend services
│       ├── FileSystemService.ts   # File I/O and watching
│       ├── MarkdownParser.ts      # Parse markdown and wikilinks
│       ├── GraphService.ts        # Compute graph relationships
│       ├── MetadataService.ts     # Whiteboard position storage
│       ├── PdfService.ts          # PDF processing
│       ├── AtomicFileStorage.ts   # Safe file writing
│       ├── DataRecovery.ts        # Backup and recovery
│       └── DataValidator.ts       # Data integrity checks
├── src/                           # React frontend (renderer process)
│   ├── App.tsx                    # Main application component
│   ├── main.tsx                   # React entry point
│   ├── components/                # UI components (30+)
│   │   ├── Sidebar.tsx            # File tree and navigation
│   │   ├── WhiteboardCanvas.tsx   # Whiteboard orchestrator
│   │   ├── Canvas.tsx             # Konva canvas renderer
│   │   ├── GraphView.tsx          # Graph view container
│   │   ├── GraphVisualization.tsx # Cytoscape graph renderer
│   │   ├── NoteEditor.tsx         # CodeMirror editor modal
│   │   ├── PDFViewer.tsx          # PDF display
│   │   ├── SearchDropdown.tsx     # Search interface
│   │   └── ...                    # Cards, arrows, groups, etc.
│   ├── store/                     # State management
│   │   └── vaultStore.ts          # Central Zustand store
│   ├── hooks/                     # Custom React hooks
│   │   ├── useVault.ts            # Vault loading logic
│   │   └── useConfirm.ts          # Confirmation dialogs
│   ├── types/                     # TypeScript definitions
│   │   └── index.ts               # Shared types
│   ├── utils/                     # Helper functions
│   └── services/                  # Frontend services
├── public/                        # Static assets
│   └── dendrite-logo.svg          # Application logo
├── package.json                   # Dependencies and scripts
├── tsconfig.json                  # TypeScript configuration
├── vite.config.ts                 # Vite build configuration
└── README.md                      # This file
```

### Data Flow

1. **File System** → Files stored as markdown in your vault folder
2. **Watcher** → Chokidar monitors changes and triggers updates
3. **Parser** → Markdown, frontmatter, and wikilinks extracted
4. **Store** → Zustand maintains app state with reactive updates
5. **UI** → React components render whiteboard and graph views
6. **Metadata** → Whiteboard positions saved in `.whiteboard-metadata.json`

### IPC Communication

The app uses Electron's context bridge for secure communication:
- `window.electronAPI.loadVault(path)` - Load vault contents
- `window.electronAPI.saveNote(note)` - Save note to disk
- `window.electronAPI.deleteNote(id)` - Delete note file
- `window.electronAPI.openDirectory()` - Show folder picker
- And more...

---

## 🛠️ Development

### Running Locally

```bash
# Install dependencies
npm install

# Start development server (Vite + Electron)
npm run electron:dev
```

This launches:
1. Vite dev server on `http://localhost:5173`
2. Electron window with hot reload enabled

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Run Vite dev server only (for web testing) |
| `npm run build` | Build frontend and backend |
| `npm run electron:dev` | Run full app in development mode |
| `npm run electron:build` | Package app for production |

### Building for Distribution

```bash
npm run electron:build
```

Uses `electron-builder` to create platform-specific installers:
- **macOS**: `.dmg` and `.app`
- **Windows**: `.exe` installer
- **Linux**: `.AppImage`, `.deb`, `.rpm`

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Commit your changes**: `git commit -m 'Add amazing feature'`
4. **Push to the branch**: `git push origin feature/amazing-feature`
5. **Open a Pull Request**

### Development Guidelines

- Follow existing code style (TypeScript, React hooks)
- Add types for new functions and components
- Test changes with `npm run electron:dev`
- Update documentation as needed

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

**Inspiration:**
- **[Heptabase](https://heptabase.com/)** - Pioneering visual note-taking with whiteboards
- **[Obsidian](https://obsidian.md/)** - Popularizing local-first, markdown-based knowledge management
- **[Roam Research](https://roamresearch.com/)** - Innovating bidirectional linking and graph thinking

**Built With:**
- **[Electron](https://www.electronjs.org/)** - Cross-platform desktop apps with web technologies
- **[React](https://react.dev/)** - Component-based UI library
- **[TypeScript](https://www.typescriptlang.org/)** - Type-safe JavaScript
- **[Konva.js](https://konvajs.org/)** - 2D canvas rendering
- **[Cytoscape.js](https://js.cytoscape.org/)** - Graph theory visualization
- **[CodeMirror](https://codemirror.net/)** - Powerful text editor component

**Special Thanks:**
- The open-source community for amazing tools and libraries

---

<div align="center">

  **Made with 🧠 and ❤️**

  [Report Bug](https://github.com/MorganJHLee/Dendrite/issues) · [Request Feature](https://github.com/MorganJHLee/Dendrite/issues) · [Discussions](https://github.com/MorganJHLee/Dendrite/discussions)

</div>
