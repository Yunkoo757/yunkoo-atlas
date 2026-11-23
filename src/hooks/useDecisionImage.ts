import { useEffect, useState } from 'react'
import { decodeReviewImage } from '@/lib/reviewImageReadiness'
import { AssetObjectUrlScope } from '@/storage/assetObjectUrls'
import { getStorage } from '@/storage/bootstrap'

export function useDecisionImage(id: string | null) {
  const [image, setImage] = useState<{ id: string; src: string | null } | null>(null)

  useEffect(() => {
    setImage(null)
    if (!id) return
    const scope = new AssetObjectUrlScope()
    let active = true

    async function load(assetId: string) {
      try {
        const src = await scope.get(getStorage(), assetId)
        if (src && active) await decodeReviewImage(src)
        if (active) setImage({ id: assetId, src })
      } catch {
        if (active) setImage({ id: assetId, src: null })
      }
    }

    void load(id)
    return () => {
      active = false
      scope.release()
    }
  }, [id])

  return id && image?.id === id ? image : null
}
