import {semver} from '../../semver.js'
import {request} from '../../http/index.js'
import {getCache, withCache} from '../../cache.js'
import {asArray, makeDeferred, tryQueue} from '../../util.js'
import {logger} from '../../logger.js'

const severityOrder = ['critical', 'high', 'moderate', 'low', 'any' ]

export const auditPlugin = async ({entry: {name, version}, options = {}, boundContext: {registry}}) => {
  options.any = options.any || options['*']
  const advisories = await getAdvisories(name, options.registry || registry)
  const vulns = advisories.filter(({vulnerable_versions}) => semver.satisfies(version, vulnerable_versions))
  const worst = Math.min(...vulns.map(({severity}) => severityOrder.indexOf(severity)))
  const directive = worst !== -1 && options[severityOrder.slice(worst).find(l => options[l])]

  return directive || false
}

auditPlugin.warmup = ({name, registry}) => getAdvisories(name, registry)

const getAdvisories = async (name, registry) => {
  const registries = asArray(registry || registry)
  const args = registries.map(r => [name, r])

  return tryQueue(getAdvisoriesDebounced, ...args)
}

const queues = {}
let timer = null

const getAdvisoriesDebounced = async (name, registry) => {
  const cache = getCache({ name: 'audit', ttl: 3600_000 })

  return withCache(cache, name, () => {
    const {promise, resolve, reject} = makeDeferred()
    const queue = (queues[registry] = queues[registry] || [])

    cache.add(name, promise)
    queue.push({name, resolve, reject})

    processQueue(queue, cache, registry)

    return promise
  })
}

const processQueue = (queue, cache, registry) => {
  if (timer) {
    return
  }

  timer = setTimeout(async () => {
    const batch = queue.slice()
    queue.length = 0
    try {
      logger.info('audit: fetching advisories for', batch.map(({name}) => name))
      const advisories = await getAdvisoriesBatch(batch.map(({name}) => name), registry)

      batch.forEach(({name, resolve}) => resolve(advisories[name] || []))
    } catch (e) {
      batch.forEach(({reject, name}) => { reject(e); cache.del(name) })
    } finally {
      timer = null
      if (queue.length) {
        processQueue(queue, cache, registry)
      }
    }
  }, 300)
}

export const getAdvisoriesBatch = async (batch = [], registry) => {
  const postData = JSON.stringify(batch.reduce((m, name) => {
    m[name] = ['0.0.0']
    return m
  }, {}))
  const headers = {
    'user-agent': 'npm/8.5.0 node/v16.14.2 darwin x64 workspaces/false',
    'npm-command': 'audit',
    'content-type': 'application/json',
    accept: '*/*'
  }
  const {body} = await request({
    method: 'POST',
    url: `${registry}/-/npm/v1/security/advisories/bulk`,
    postData,
    headers,
    gzip: true
  })

  return JSON.parse(body)
}

export default auditPlugin
