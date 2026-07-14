export const MAX_NOTION_IMAGE_BYTES = 32 * 1024 * 1024
export const MAX_NOTION_IMPORT_IMAGE_BYTES = 96 * 1024 * 1024
export const MAX_NOTION_EXPANDED_BYTES = 160 * 1024 * 1024
export const MAX_NOTION_NESTED_ZIP_DEPTH = 4
export const MAX_NOTION_ARCHIVE_COUNT = 64
export const MAX_NOTION_IMPORT_ROWS = 20_000

export function assertNotionImageByteAddition(imageBytes: number, previousTotalBytes: number): void {
  if (imageBytes > MAX_NOTION_IMAGE_BYTES) {
    throw new Error('单张原图超过 32 MB，请移除该附件后重试；为保留画质，软件不会自动压缩原图')
  }
  if (previousTotalBytes + imageBytes > MAX_NOTION_IMPORT_IMAGE_BYTES) {
    throw new Error('本次原图总量超过 96 MB，请分批导入；为保留画质，软件不会自动压缩原图')
  }
}

export function assertNotionImageByteLimits(imageBytes: readonly number[]): void {
  let total = 0
  for (const bytes of imageBytes) {
    assertNotionImageByteAddition(bytes, total)
    total += bytes
  }
}
