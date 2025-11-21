import { useState } from 'react'
import { Folder, FolderOpen, FileText, Edit, Trash2 } from 'lucide-react'
import type { VaultFile } from '../types'
import ContextMenu, { type ContextMenuItem } from './ContextMenu'
import RenameModal from './RenameModal'
import { useVaultStore } from '../store/vaultStore'
import { useConfirm } from '../hooks/useConfirm'
import './FileTree.css'

interface FileTreeProps {
  files: VaultFile[]
  selectedNoteId: string | null
  vaultPath: string | null
  onSelectFile: (file: VaultFile) => void
  onEditFile?: (file: VaultFile) => void
  searchQuery?: string
}

interface ContextMenuState {
  x: number
  y: number
  file: VaultFile
}

interface FileTreeNodeProps {
  file: VaultFile
  level: number
  selectedNoteId: string | null
  vaultPath: string | null
  onSelectFile: (file: VaultFile) => void
  onEditFile?: (file: VaultFile) => void
  onContextMenu?: (e: React.MouseEvent, file: VaultFile) => void
  onMoveFile?: (filePath: string, targetFolderPath: string) => void
  onDragEnd?: () => void
}

function FileTreeNode({ file, level, selectedNoteId, vaultPath, onSelectFile, onEditFile, onContextMenu, onMoveFile, onDragEnd }: FileTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isDragOver, setIsDragOver] = useState(false)
  const isDirectory = file.type === 'directory'
  const isMarkdown = file.name.endsWith('.md')

  // Check if this file is selected (compare by path)
  const isSelected = selectedNoteId && file.path.includes(selectedNoteId)

  const handleClick = () => {
    if (isDirectory) {
      setIsExpanded(!isExpanded)
    } else if (isMarkdown) {
      onSelectFile(file)
    }
  }

  const handleDoubleClick = () => {
    if (!isDirectory && isMarkdown && onEditFile) {
      onEditFile(file)
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    // Allow context menu for both files and directories
    if ((isDirectory || isMarkdown) && onContextMenu) {
      e.preventDefault()
      onContextMenu(e, file)
    }
  }

  const handleDragStart = (e: React.DragEvent) => {
    if (!isMarkdown) return
    e.dataTransfer.setData('filePath', file.path)

    // Calculate noteId using same logic as MarkdownParser.getNoteId
    let noteId = file.path
    if (vaultPath) {
      if (noteId.startsWith(vaultPath)) {
        noteId = noteId.substring(vaultPath.length)
      }
    }
    noteId = noteId.replace(/^[/\\]+/, '')
    noteId = noteId.replace(/\.md$/, '')
    noteId = noteId.replace(/\\/g, '/')

    e.dataTransfer.setData('noteId', noteId)
    e.dataTransfer.effectAllowed = 'copyMove'
  }

  const handleDragEnd = () => {
    if (onDragEnd) {
      onDragEnd()
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (!isDirectory) return
    e.preventDefault()
    e.stopPropagation() // Prevent event from bubbling to root drag handler
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    if (!isDirectory) return
    e.preventDefault()
    e.stopPropagation() // Prevent event from bubbling to root drop handler
    setIsDragOver(false)

    const filePath = e.dataTransfer.getData('filePath')
    if (filePath && onMoveFile && filePath !== file.path) {
      onMoveFile(filePath, file.path)
    }
  }

  return (
    <div className="file-tree-node">
      <div
        className={`file-tree-item ${isSelected ? 'selected' : ''} ${isDragOver ? 'drag-over' : ''}`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        draggable={isMarkdown}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <span className="file-icon">
          {isDirectory ? (isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />) : <FileText size={16} />}
        </span>
        <span className="file-name">{file.name}</span>
      </div>

      {isDirectory && isExpanded && file.children && (
        <div className="file-tree-children">
          {file.children.map((child) => (
            <FileTreeNode
              key={child.path}
              file={child}
              level={level + 1}
              selectedNoteId={selectedNoteId}
              vaultPath={vaultPath}
              onSelectFile={onSelectFile}
              onEditFile={onEditFile}
              onContextMenu={onContextMenu}
              onMoveFile={onMoveFile}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FileTree({ files, selectedNoteId, onSelectFile, onEditFile, searchQuery }: FileTreeProps) {
  const { deleteNote, notes, vaultPath, updateFileInTree, setSelectedNoteId, setFiles } = useVaultStore()
  const { confirm } = useConfirm()
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renameModal, setRenameModal] = useState<{ noteId: string; currentName: string; path: string } | null>(null)
  const [folderRenameModal, setFolderRenameModal] = useState<{ currentName: string; path: string } | null>(null)
  const [isRootDragOver, setIsRootDragOver] = useState(false)

  // Filter files based on search query
  const filterFiles = (files: VaultFile[], query: string): VaultFile[] => {
    if (!query.trim()) return files

    const lowerQuery = query.toLowerCase()

    const matchesSearch = (file: VaultFile): boolean => {
      // Check file name
      if (file.name.toLowerCase().includes(lowerQuery)) {
        return true
      }

      // For markdown files, check note title and content
      if (file.name.endsWith('.md')) {
        const noteId = file.path.replace(/\.md$/, '')
        const note = notes.get(noteId)
        if (note) {
          // Check title
          if (note.title.toLowerCase().includes(lowerQuery)) {
            return true
          }
          // Check content
          if (note.content.toLowerCase().includes(lowerQuery)) {
            return true
          }
        }
      }

      return false
    }

    const filterRecursive = (files: VaultFile[]): VaultFile[] => {
      const filtered: VaultFile[] = []

      for (const file of files) {
        if (file.type === 'directory') {
          // Recursively filter children
          const filteredChildren = file.children ? filterRecursive(file.children) : []

          // Include directory if it has matching children or matches itself
          if (filteredChildren.length > 0 || matchesSearch(file)) {
            filtered.push({
              ...file,
              children: filteredChildren
            })
          }
        } else {
          // Include file if it matches
          if (matchesSearch(file)) {
            filtered.push(file)
          }
        }
      }

      return filtered
    }

    return filterRecursive(files)
  }

  const filteredFiles = searchQuery ? filterFiles(files, searchQuery) : files

  const handleContextMenu = (e: React.MouseEvent, file: VaultFile) => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      file,
    })
  }

  const handleRename = (file: VaultFile) => {
    // Compute noteId the same way as in handleMoveFile
    const noteId = file.path
      .replace(vaultPath || '', '')
      .replace(/^[\\\/]/, '')
      .replace(/\.md$/, '')
      .replace(/\\/g, '/')
    const note = notes.get(noteId)
    if (note) {
      setRenameModal({
        noteId: note.id,
        currentName: note.title,
        path: note.path,
      })
    }
  }

  const performRename = async (newName: string) => {
    if (!renameModal || !vaultPath) return

    const note = notes.get(renameModal.noteId)
    if (!note || newName === note.title) return

    try {
      // Update frontmatter with new title
      const updatedFrontmatter = {
        ...(note.frontmatter || {}),
        title: newName,
      }

      // Serialize with frontmatter
      const frontmatterLines = Object.entries(updatedFrontmatter).map(([key, value]) => {
        if (typeof value === 'string') {
          return `${key}: ${value}`
        } else if (Array.isArray(value)) {
          const arrayValue = value as any[]
          return `${key}: [${arrayValue.map((v: any) => typeof v === 'string' ? `"${v}"` : v).join(', ')}]`
        } else {
          return `${key}: ${JSON.stringify(value)}`
        }
      })

      const fileContent = `---\n${frontmatterLines.join('\n')}\n---\n${note.content}`

      // Create new file path
      const oldPath = note.path
      const normalizedPath = oldPath.replace(/\\/g, '/')
      const lastSlashIndex = normalizedPath.lastIndexOf('/')
      const directory = normalizedPath.substring(0, lastSlashIndex)
      const newPath = `${directory}/${newName}.md`
      const finalNewPath = oldPath.includes('\\') ? newPath.replace(/\//g, '\\') : newPath

      // Write updated content to old path
      await window.electronAPI.writeFile(oldPath, fileContent)

      // Rename the file
      await window.electronAPI.renameFile(oldPath, finalNewPath)

      // Update file tree
      updateFileInTree(oldPath, finalNewPath, `${newName}.md`)

      // Update the selected note ID if this note is selected
      if (selectedNoteId === renameModal.noteId) {
        const newId = finalNewPath
          .replace(vaultPath, '')
          .replace(/^[\\\/]/, '')
          .replace(/\.md$/, '')
          .replace(/\\/g, '/')
        setSelectedNoteId(newId)
      }
    } catch (error) {
      console.error('Error renaming note:', error)
      alert('Failed to rename note')
    }
  }

  const handleDelete = async (file: VaultFile) => {
    // Compute noteId the same way as in handleMoveFile
    const noteId = file.path
      .replace(vaultPath || '', '')
      .replace(/^[\\\/]/, '')
      .replace(/\.md$/, '')
      .replace(/\\/g, '/')
    const note = notes.get(noteId)

    if (!note) return

    const confirmed = await confirm({
      message: `Are you sure you want to delete "${note.title}"?`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      isDanger: true
    })

    if (!confirmed) {
      return
    }

    try {
      // Delete from filesystem
      await window.electronAPI.deleteFile(file.path)

      // Remove from store
      deleteNote(noteId)

      // Refresh the file tree to reflect the deletion
      if (vaultPath) {
        const updatedFiles = await window.electronAPI.readVault(vaultPath)
        setFiles(updatedFiles)
      }
    } catch (error) {
      console.error('Error deleting note:', error)
      alert('Failed to delete note')
    }
  }

  const handleFolderRename = (file: VaultFile) => {
    const folderName = file.name
    setFolderRenameModal({
      currentName: folderName,
      path: file.path,
    })
  }

  const performFolderRename = async (newName: string) => {
    if (!folderRenameModal || !vaultPath) return
    if (newName === folderRenameModal.currentName) return

    try {
      const oldPath = folderRenameModal.path
      // Handle both forward and backward slashes
      const separator = oldPath.includes('\\') ? '\\' : '/'
      const lastSepIndex = oldPath.lastIndexOf(separator)
      const parentPath = oldPath.substring(0, lastSepIndex)
      const newPath = parentPath + separator + newName

      await window.electronAPI.renameFolder(oldPath, newPath)

      // Refresh the file tree
      const updatedFiles = await window.electronAPI.readVault(vaultPath)
      setFiles(updatedFiles)
    } catch (error) {
      console.error('Error renaming folder:', error)
      alert('Failed to rename folder')
    }
  }

  const handleFolderDelete = async (file: VaultFile) => {
    const confirmed = await confirm({
      message: `Are you sure you want to delete the folder "${file.name}" and all its contents?`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      isDanger: true
    })

    if (!confirmed) {
      return
    }

    try {
      await window.electronAPI.deleteFolder(file.path)

      // Refresh the file tree
      if (vaultPath) {
        const updatedFiles = await window.electronAPI.readVault(vaultPath)
        setFiles(updatedFiles)
      }
    } catch (error) {
      console.error('Error deleting folder:', error)
      alert('Failed to delete folder')
    }
  }

  const handleMoveFile = async (filePath: string, targetFolderPath: string) => {
    if (!vaultPath) return

    try {
      // Move the file
      const newPath = await window.electronAPI.moveFile(filePath, targetFolderPath)

      // Compute new note ID based on new path
      const newId = newPath
        .replace(vaultPath, '')
        .replace(/^[\\\/]/, '')
        .replace(/\.md$/, '')
        .replace(/\\/g, '/')

      // Get old note ID
      const oldId = filePath
        .replace(vaultPath, '')
        .replace(/^[\\\/]/, '')
        .replace(/\.md$/, '')
        .replace(/\\/g, '/')

      // Get fresh state from store
      const oldNote = notes.get(oldId)

      if (oldNote) {
        // Create new note with updated ID and path
        const newNote = {
          ...oldNote,
          id: newId,
          path: newPath,
        }

        // Remove old note and add new one
        deleteNote(oldId)
        useVaultStore.getState().addNote(newNote)

        // Update editingNoteId if this note is being edited
        const currentEditingNoteId = useVaultStore.getState().editingNoteId
        if (currentEditingNoteId === oldId) {
          setSelectedNoteId(newId)
          useVaultStore.getState().setEditingNoteId(newId)
        }
      }

      // Refresh the file tree
      const updatedFiles = await window.electronAPI.readVault(vaultPath)
      setFiles(updatedFiles)
    } catch (error) {
      console.error('Error moving file:', error)
      alert('Failed to move file')
    }
  }

  const handleRootDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsRootDragOver(true)
  }

  const handleRootDragLeave = (e: React.DragEvent) => {
    // Only set to false if we're leaving the file-tree container entirely
    if (e.currentTarget === e.target) {
      setIsRootDragOver(false)
    }
  }

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsRootDragOver(false)

    const filePath = e.dataTransfer.getData('filePath')
    if (filePath && vaultPath) {
      handleMoveFile(filePath, vaultPath)
    }
  }

  const handleDragEnd = () => {
    setIsRootDragOver(false)
  }

  const contextMenuItems: ContextMenuItem[] = contextMenu
    ? contextMenu.file.type === 'directory'
      ? [
          {
            label: 'Rename',
            icon: <Edit size={16} />,
            onClick: () => handleFolderRename(contextMenu.file),
          },
          {
            label: 'Delete',
            icon: <Trash2 size={16} />,
            danger: true,
            onClick: () => handleFolderDelete(contextMenu.file),
          },
        ]
      : [
          {
            label: 'Rename',
            icon: <Edit size={16} />,
            onClick: () => handleRename(contextMenu.file),
          },
          {
            label: 'Delete',
            icon: <Trash2 size={16} />,
            danger: true,
            onClick: () => handleDelete(contextMenu.file),
          },
        ]
    : []

  if (files.length === 0) {
    return <div className="file-tree-empty">No files in vault</div>
  }

  if (filteredFiles.length === 0 && searchQuery) {
    return <div className="file-tree-empty">No results found for "{searchQuery}"</div>
  }

  return (
    <>
      <div
        className={`file-tree ${isRootDragOver ? 'root-drag-over' : ''}`}
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        {filteredFiles.map((file) => (
          <FileTreeNode
            key={file.path}
            file={file}
            level={0}
            selectedNoteId={selectedNoteId}
            vaultPath={vaultPath}
            onSelectFile={onSelectFile}
            onEditFile={onEditFile}
            onContextMenu={handleContextMenu}
            onMoveFile={handleMoveFile}
            onDragEnd={handleDragEnd}
          />
        ))}
        {isRootDragOver && (
          <div className="root-drop-indicator">
            <Folder size={16} /> Drop here to move to root folder
          </div>
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
      {renameModal && (
        <RenameModal
          currentName={renameModal.currentName}
          onRename={performRename}
          onClose={() => setRenameModal(null)}
        />
      )}
      {folderRenameModal && (
        <RenameModal
          currentName={folderRenameModal.currentName}
          onRename={performFolderRename}
          onClose={() => setFolderRenameModal(null)}
        />
      )}
    </>
  )
}
