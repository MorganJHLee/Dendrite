/**
 * Service for handling image operations in the vault
 */

interface ImageMetadata {
  filename: string
  originalName: string
  usedByNotes: Set<string> // Note IDs that use this image
  createdAt: Date
}

// Global registry of image usage
const imageRegistry = new Map<string, ImageMetadata>()

/**
 * Get the attachments folder path for the vault
 */
export function getAttachmentsFolderPath(vaultPath: string): string {
  return `${vaultPath}/.attachments`
}

/**
 * Generate a unique filename for a pasted image
 */
export function generateImageFilename(extension: string = 'png'): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `pasted-image-${timestamp}-${random}.${extension}`
}

/**
 * Save a pasted image to the attachments folder
 */
export async function savePastedImage(
  imageBlob: Blob,
  vaultPath: string,
  noteId: string
): Promise<string> {
  // Ensure attachments folder exists
  const attachmentsPath = getAttachmentsFolderPath(vaultPath)
  await window.electronAPI.ensureDirectory(attachmentsPath)

  // Generate unique filename
  const extension = imageBlob.type.split('/')[1] || 'png'
  const filename = generateImageFilename(extension)
  const fullPath = `${attachmentsPath}/${filename}`

  // Convert blob to base64
  const base64 = await blobToBase64(imageBlob)

  // Save to file system
  await window.electronAPI.writeImageFile(fullPath, base64)

  // Register image usage
  registerImageUsage(filename, noteId)

  return filename
}

/**
 * Convert Blob to base64 string
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const base64 = reader.result as string
      // Remove data URL prefix (e.g., "data:image/png;base64,")
      const base64Data = base64.split(',')[1]
      resolve(base64Data)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Register that an image is used by a note
 */
export function registerImageUsage(filename: string, noteId: string): void {
  let metadata = imageRegistry.get(filename)
  if (!metadata) {
    metadata = {
      filename,
      originalName: filename,
      usedByNotes: new Set(),
      createdAt: new Date(),
    }
    imageRegistry.set(filename, metadata)
  }
  metadata.usedByNotes.add(noteId)
}

/**
 * Unregister that an image is used by a note
 */
export function unregisterImageUsage(filename: string, noteId: string): void {
  const metadata = imageRegistry.get(filename)
  if (metadata) {
    metadata.usedByNotes.delete(noteId)
  }
}

/**
 * Scan note content for image references and update registry
 */
export function scanNoteForImages(noteId: string, content: string): void {
  // Clear existing registrations for this note
  for (const metadata of imageRegistry.values()) {
    metadata.usedByNotes.delete(noteId)
  }

  // Find all image references
  const images = extractImageReferences(content)

  // Register each image
  for (const imagePath of images) {
    // Extract filename from path
    const filename = imagePath.split('/').pop() || imagePath
    registerImageUsage(filename, noteId)
  }
}

/**
 * Extract all image references from note content
 */
function extractImageReferences(content: string): string[] {
  const images: string[] = []

  // Match markdown images: ![alt](path)
  const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  let match
  while ((match = markdownImageRegex.exec(content)) !== null) {
    const imagePath = match[2]
    // Only track local images (not URLs)
    if (!imagePath.startsWith('http://') && !imagePath.startsWith('https://')) {
      images.push(imagePath)
    }
  }

  // Match Obsidian images: ![[path]]
  const obsidianImageRegex = /!\[\[([^\]]+)\]\]/g
  while ((match = obsidianImageRegex.exec(content)) !== null) {
    images.push(match[1])
  }

  return images
}

/**
 * Clean up unused images from the attachments folder
 */
export async function cleanupUnusedImages(vaultPath: string): Promise<number> {
  const attachmentsPath = getAttachmentsFolderPath(vaultPath)
  let deletedCount = 0

  try {
    // Get list of all files in attachments folder
    const files = await window.electronAPI.readDirectory(attachmentsPath)

    for (const file of files) {
      // Skip directories
      if (file.isDirectory) continue

      // Check if image is registered and used
      const metadata = imageRegistry.get(file.name)
      if (!metadata || metadata.usedByNotes.size === 0) {
        // Delete unused image
        const filePath = `${attachmentsPath}/${file.name}`
        await window.electronAPI.deleteFile(filePath)
        imageRegistry.delete(file.name)
        deletedCount++
        console.log(`Deleted unused image: ${file.name}`)
      }
    }
  } catch (error) {
    console.error('Error cleaning up unused images:', error)
  }

  return deletedCount
}

/**
 * Initialize image registry by scanning all notes
 */
export function initializeImageRegistry(notes: Map<string, { id: string; content: string }>): void {
  imageRegistry.clear()
  for (const note of notes.values()) {
    scanNoteForImages(note.id, note.content)
  }
}

/**
 * Get image statistics
 */
export function getImageStats(): {
  totalImages: number
  usedImages: number
  unusedImages: number
} {
  let used = 0
  let unused = 0

  for (const metadata of imageRegistry.values()) {
    if (metadata.usedByNotes.size > 0) {
      used++
    } else {
      unused++
    }
  }

  return {
    totalImages: imageRegistry.size,
    usedImages: used,
    unusedImages: unused,
  }
}
