import express from 'express'
import { getProviderAvailability } from '../providers/index.js'
import { userRateLimit } from '../middleware/rate-limit.js'

const router = express.Router()

router.get('/', userRateLimit({ key: 'provider-status', limit: 60 }), (_req, res) => {
  return res.json({ providers: getProviderAvailability() })
})

export default router
