import http from 'node:http'
import https from 'node:https'

import {makeDeferred} from '../util.js'
import {INTERNAL_SERVER_ERROR, statusMessages} from './error.js'
import {logger} from '../logger.js'

const createSocketPool = () => {
  const sockets = new Set()
  return {
    add(socket) {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    },
    destroyAll() {
      for (const socket of sockets.values()) {
        socket.destroy()
      }
    }
  }
}

const sendJson = function(data, code = 200) {
  const buffer = Buffer.from(JSON.stringify(data))
  this.writeHead(code, {
    'Content-Type': 'application/json',
    'Connection': 'keep-alive',
    'Content-Length': buffer.length,
  })
    .end(buffer)
}

export const createServer = ({host, port, secure, router, keepAliveTimeout, headersTimeout, requestTimeout }) => {
  const entrypoint = `${secure ? 'https' : 'http'}://${host}:${port}`
  const lib = secure ? https : http
  const options = {...secure}
  const sockets = createSocketPool()
  const server = lib.createServer(options, async (req, res) => {
    try {
      res.json = sendJson
      await router(req, res)

    } catch (e) {
      const message = e?.res?.statusMessage || statusMessages[INTERNAL_SERVER_ERROR]
      const code = e?.res?.statusCode || INTERNAL_SERVER_ERROR

      res
        .writeHead(code)
        .end(message)

      logger.error(e)
    }
  })
  server.keepAliveTimeout = keepAliveTimeout
  server.headersTimeout = headersTimeout
  server.timeout = requestTimeout * 2 // Final bastion

  server.on('connection', socket => sockets.add(socket))

  server.start = async () => {
    const {promise, resolve, reject} = makeDeferred()
    server.listen(port, host, (err) => {
      if (err) {
        return reject(err)
      }
      resolve()
      logger.info(`npm-registry-firewall is ready for connections: ${entrypoint}`)
    })

    return promise
  }

  server.stop = async () => {
    const {promise, resolve, reject} = makeDeferred()

    sockets.destroyAll()
    server.close((err) => {
      if (err) {
        return reject(err)
      }

      logger.info(`npm-registry-firewall has been stopped: ${entrypoint}`)
      resolve()
    })

    return promise
  }

  return server
}
