import {request, notFoundErr, accessDeniedErr} from '../http/index.js'
import {semver} from '../semver.js'
import {normalizePath} from '../util.js'

export const firewall = ({registry, rules, entrypoint: _entrypoint, token}) => async (req, res, next) => {
  if (!registry) {
    throw new Error('firewall: req.cfg.registry is required')
  }
  const {cfg, routeParams: {name, version, org}, base} = req
  const {body, headers} = await request({
    url: `${registry}/${name}`,
    authorization: token && `Bearer ${token}`
  })
  const entrypoint = _entrypoint || normalizePath(`${cfg.server.entrypoint}${base}`)
  const packument = JSON.parse(body)
  const directives = getDirectives({ packument, rules, org})

  // Tarball request
  if (version) {
    const policy = getPolicy(directives, version)
    if (policy === 'warn') {
      req.log.warn(`${name}@${version}`, 'directive=', directives[version]._raw)
    }
    return policy === 'deny' ? next(accessDeniedErr) : next()
  }

  // Packument request
  const _packument = patchPackument({ packument, directives, entrypoint, registry })

  if (Object.keys(_packument.versions).length === 0) {
    return next(notFoundErr)
  }

  const packumentBuffer = Buffer.from(JSON.stringify(_packument))
  res.writeHead(200, {
    ...headers,
    'content-length': '' + packumentBuffer.length
  })
  res.write(packumentBuffer)
  res.end()
}

export const getDirectives = ({packument, rules, org}) =>
  Object.entries(packument.versions).reduce((m, [k, {version, license, _npmUser, name}]) => {
    const time = Date.parse(packument.time[version])
    m[k] = getDirective({rules, name, org, version, time, license, _npmUser})
    return m
  }, {})

export const getDirective = ({rules, name, org, version, time, license, _npmUser, now = Date.now()}) => rules.reduce((m, r) => {
  if (m) {
    return m
  }
  const day = 24 * 3600 * 1000
  const matched =
    (r.org ? org && r.org.some(e => e.test(org)) : true)
    && (r.name ? r.name.some(e => e.test(name)) : true)
    && (r.license ? r.license.includes(license?.toLowerCase()) : true)
    && (r.username ? r.username.includes(_npmUser?.name?.toLowerCase()) : true)
    && (r.dateRange ? time >= r.dateRange[0] && time <= r.dateRange[1] : true)
    && (r.age ? time <= now - r.age[0] * day && time >= now - (r.age[1] * day || Infinity) : true)
    && (r.version ? semver.satisfies(version, r.version): true)

  return !!matched && r
}, false)

export const getPolicy = (directives, version) => directives[version]?.policy

export const filterVersions = ({packument, directives, entrypoint, registry}) => Object.values(packument.versions).reduce((m, v) => {
  if (getPolicy(directives, v.version) === 'deny') {
    return m
  }

  v.dist.tarball = v.dist.tarball.replace(registry, entrypoint)
  m[v.version] = v
  return m
}, {})

export const filterTime = (versions, time) => Object.entries(time).reduce((m, [k, v]) => {
  if (versions[k]) {
    m[k] = v
  }
  return m
}, {
  created: time.created,
  modified: time.modified,
})

export const patchPackument = ({packument, directives, entrypoint, registry}) => {
  const versions = filterVersions({packument, directives, entrypoint, registry})
  const time = filterTime(versions, packument.time)

  const latestVersion = Object.keys(versions).reduce((m, v) => time[m] > time[v] ? m : v , null);
  const distTags = { latest: latestVersion }
  const latestEntry = versions[latestVersion] || {}

  return {
    ...packument,
    author: latestEntry.author,
    license: latestEntry.license,
    maintainer: latestEntry.maintainer,
    'dist-tags': distTags,
    time,
    versions
  }
}

