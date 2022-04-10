import { createServer } from './server.js'
import { createRouter } from './router.js'
import { healthcheck } from './mwares/healthcheck.js'
import { errorBoundary } from './mwares/error-boundary.js'
import { notFound } from './mwares/not-found.js'
import { trace } from './mwares/trace.js'
import { proxy } from './mwares/proxy.js'
import { packument } from './mwares/packument.js'
import { getConfig } from './config.js'
import { ctx } from './mwares/ctx.js'
import { firewall } from './mwares/firewall.js'

export const createApp = (_config) => {
  const config = typeof _config === 'string'
    ? getConfig(_config)
    : _config
  const router = createRouter([
    [ ctx(config) ],
    [ trace ],
    ['GET', '/status/', healthcheck],
    [ '*', [/^\/([a-z0-9\-]+)\/-\/[a-z0-9\-]+-(\d+\.\d+\.\d+(?:-.+)?)\.tgz$/, ['name', 'version']], packument ],
    [ firewall ],
    [ proxy ],
    [ notFound ],
    [ errorBoundary ],
  ])
  const servers = config.server.map(s => createServer({...s, router}))

  return {
    servers,
    config,
    router,
    start() { return Promise.all(servers.map(s => s.start())) },
    stop() { return Promise.all(servers.map(s => s.stop())) }
  }
}