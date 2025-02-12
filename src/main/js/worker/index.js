import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const concurrencyLimit = os.cpus().length
const wc = process.env.WEB_CONCURRENCY | 0

const queue = []
let concurrency = wc <= concurrencyLimit && wc > 0 ? wc : concurrencyLimit

export const runWorker = (workerName, workerData) => new Promise((resolve, reject) => {
  queue.push({workerName, workerData, resolve, reject})
  processQueue()
})

const processQueue = () => {
  if (concurrency === 0 || queue.length === 0) {
    return
  }
  concurrency -= 1

  const {resolve, reject, workerName, workerData} = queue.shift()
  const worker = new Worker(path.resolve(__dirname, workerName), { workerData })

  worker.on('message', ({err, result}) => {
    if (err) {
      reject(err)
    } else {
      resolve(result)
    }
  })
  worker.on('error', reject)
  worker.on('exit', (code) => {
    if (code !== 0) {
      reject(new Error(`stopped with  ${code} exit code`))
    }
    concurrency += 1
    processQueue()
  })
}
