import { useEffect, useState } from 'react'
import { decodeReviewImage } from '@/lib/reviewImageReadiness'
import { AssetObjectUrlScope } from '@/storage/assetObjectUrls'
import { getStorage } from '@/storage/bootstrap'

export function useDecisionImage(id: string | null) {
  const [attempt, setAttempt] = useState(0)
  const [image, setImage] = useState<{ id: string; attempt: number; src: string | null } | null>(null)

  useEffect(() => {
    if (!id) return
    const scope = new AssetObjectUrlScope()
    let active = true

    async function load(assetId: string) {
      try {
        const src = await scope.get(getStorage(), assetId)
        if (src && active) await decodeReviewImage(src)
        if (active) setImage({ id: assetId, attempt, src })
      } catch {
        if (active) setImage({ id: assetId, attempt, src: null })
      }
    }

    void load(id)
    return () => {
      active = false
      scope.release()
    }
  }, [id, attempt])

  return {
    image: id && image?.id === id && image.attempt === attempt ? image : null,
    retry: () => setAttempt(value => value + 1),
  }
}
