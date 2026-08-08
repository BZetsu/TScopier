/** Limits for assistant image attachments (data URLs sent to OpenAI vision). */
export const ASSISTANT_MAX_IMAGES = 3
export const ASSISTANT_ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
])

const MAX_DIMENSION = 1280
const JPEG_QUALITY = 0.72
/** Rough cap on data-URL length after compress (~0.9MB binary). */
const MAX_DATA_URL_CHARS = 1_200_000

export function isAssistantImageType(type: string): boolean {
  return ASSISTANT_ACCEPTED_IMAGE_TYPES.has(type.toLowerCase())
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    img.src = url
  })
}

/** Resize + JPEG-compress a file into a data URL suitable for the assistant. */
export async function fileToAssistantImageDataUrl(file: File): Promise<string> {
  if (!isAssistantImageType(file.type)) {
    throw new Error('unsupported_type')
  }
  const img = await loadImageFromFile(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height, 1))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas_unavailable')
  ctx.drawImage(img, 0, 0, w, h)
  let quality = JPEG_QUALITY
  let dataUrl = canvas.toDataURL('image/jpeg', quality)
  while (dataUrl.length > MAX_DATA_URL_CHARS && quality > 0.4) {
    quality -= 0.1
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }
  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    throw new Error('too_large')
  }
  return dataUrl
}

export function isAssistantImageDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('data:image/') &&
    value.includes(';base64,') &&
    value.length <= MAX_DATA_URL_CHARS * 1.1
  )
}
