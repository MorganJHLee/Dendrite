// Lazy import to avoid initialization issues
let pdfjsModule: any = null
let configured = false

async function getPdfjs() {
  if (!pdfjsModule) {
    // For pdfjs-dist v3.x in Electron with Vite, import from the build path
    // The module has no default export; all APIs are direct named exports
    // @ts-ignore - Dynamic import path for pdfjs-dist
    pdfjsModule = await import('pdfjs-dist/build/pdf')

    // Configure PDF.js worker (only once)
    if (!configured && pdfjsModule.GlobalWorkerOptions) {
      // Worker file is copied to public/ (dev) and dist/ (prod) by vite plugin
      pdfjsModule.GlobalWorkerOptions.workerSrc = './pdf.worker.min.js'
      configured = true
    }
  }
  return pdfjsModule
}

export interface PdfDocumentInfo {
  pageCount: number
  fileName: string
  fileSize: number
}

/**
 * Load a PDF document from a file path
 */
export async function loadPdfDocument(pdfPath: string): Promise<any> {
  try {
    const pdfjs = await getPdfjs()

    // Read the PDF file as array buffer
    const pdfDataArray = await window.electronAPI.pdfReadFile(pdfPath)
    const pdfData = new Uint8Array(pdfDataArray)

    // Load the PDF document - getDocument is a named export
    const loadingTask = pdfjs.getDocument({ data: pdfData })
    const pdfDoc = await loadingTask.promise

    return pdfDoc
  } catch (error) {
    console.error('Error loading PDF document:', error)
    throw error
  }
}

/**
 * Get PDF document information
 */
export async function getPdfInfo(pdfPath: string): Promise<PdfDocumentInfo> {
  try {
    const pdfDoc = await loadPdfDocument(pdfPath)
    const backendInfo = await window.electronAPI.pdfGetInfo(pdfPath)

    return {
      pageCount: pdfDoc.numPages,
      fileName: backendInfo.fileName,
      fileSize: backendInfo.fileSize,
    }
  } catch (error) {
    console.error('Error getting PDF info:', error)
    throw error
  }
}

/**
 * Generate a thumbnail from the first page of a PDF
 * Returns a base64 PNG image data URL
 */
export async function generatePdfThumbnail(
  pdfPath: string,
  width: number = 200,
  height: number = 300
): Promise<string> {
  try {
    const pdfDoc = await loadPdfDocument(pdfPath)

    // Get first page
    const page = await pdfDoc.getPage(1)

    // Calculate scale to fit within desired dimensions while maintaining aspect ratio
    const viewport = page.getViewport({ scale: 1 })
    const scaleX = width / viewport.width
    const scaleY = height / viewport.height
    const scale = Math.min(scaleX, scaleY)

    // Get scaled viewport
    const scaledViewport = page.getViewport({ scale })

    // Create canvas
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Failed to get canvas context')
    }

    canvas.width = scaledViewport.width
    canvas.height = scaledViewport.height

    // Render PDF page to canvas
    const renderContext = {
      canvasContext: context,
      viewport: scaledViewport,
    }

    await page.render(renderContext).promise

    // Convert canvas to blob
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to create blob from canvas'))
          return
        }

        // Convert blob to data URL
        const reader = new FileReader()
        reader.onloadend = () => {
          resolve(reader.result as string)
        }
        reader.onerror = reject
        reader.readAsDataURL(blob)
      }, 'image/png')
    })
  } catch (error) {
    console.error('Error generating PDF thumbnail:', error)
    throw error
  }
}

/**
 * Save thumbnail to disk
 */
export async function savePdfThumbnail(
  thumbnailDataUrl: string,
  pdfFileName: string
): Promise<string> {
  try {
    // Convert data URL to array buffer
    const base64Data = thumbnailDataUrl.split(',')[1]
    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    // Save thumbnail via IPC
    const thumbnailPath = await window.electronAPI.pdfSaveThumbnail(
      Array.from(bytes),
      pdfFileName
    )

    return thumbnailPath
  } catch (error) {
    console.error('Error saving PDF thumbnail:', error)
    throw error
  }
}

/**
 * Load thumbnail from disk and convert to data URL
 */
export async function loadPdfThumbnail(thumbnailPath: string): Promise<string> {
  try {
    const thumbnailDataArray = await window.electronAPI.pdfReadThumbnail(thumbnailPath)
    const thumbnailData = new Uint8Array(thumbnailDataArray)

    // Convert to base64
    let binary = ''
    const len = thumbnailData.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(thumbnailData[i])
    }
    const base64 = btoa(binary)

    return `data:image/png;base64,${base64}`
  } catch (error) {
    console.error('Error loading PDF thumbnail:', error)
    throw error
  }
}

/**
 * Render text layer for a PDF page using the official PDF.js text layer API
 * This ensures accurate text selection that matches the rendered PDF exactly
 */
export async function renderTextLayer(
  page: any,
  textLayerDiv: HTMLDivElement,
  viewport: any
): Promise<void> {
  try {
    // Clear existing text layer
    textLayerDiv.innerHTML = ''

    // Set the required CSS variable for PDF.js text layer positioning
    // This must match the viewport scale for accurate text placement
    textLayerDiv.style.setProperty('--scale-factor', viewport.scale.toString())

    // Set text layer dimensions to match viewport
    textLayerDiv.style.width = `${viewport.width}px`
    textLayerDiv.style.height = `${viewport.height}px`

    // Get the PDF.js module which includes renderTextLayer
    const pdfjs = await getPdfjs()

    // Get text content from the page
    const textContent = await page.getTextContent()

    // Use PDF.js's official renderTextLayer function
    // This handles all the complex transform calculations correctly
    const renderTask = pdfjs.renderTextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport: viewport,
      textDivs: []
    })

    await renderTask.promise
  } catch (error) {
    console.error('Error rendering text layer:', error)
    throw error
  }
}
