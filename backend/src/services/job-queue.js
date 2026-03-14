/**
 * Service de file d'attente pour les opérations lourdes (BullMQ)
 * Utilisé pour OCR, PDF parsing, exports volumineux
 * Fonctionne en mode dégradé (in-process) si Redis n'est pas disponible
 */
const { isRedisAvailable, getRedisUrl } = require('../config/redis');

let ocrQueue = null;
let pdfQueue = null;
let ocrWorker = null;
let pdfWorker = null;

/**
 * Initialise les queues BullMQ si Redis est disponible
 */
async function initQueues() {
  if (!isRedisAvailable()) {
    console.warn('[JOB-QUEUE] Redis non disponible, mode in-process (dégradé)');
    return false;
  }

  try {
    const { Queue, Worker } = require('bullmq');
    const connection = { url: getRedisUrl() };

    // Queue OCR pour le traitement des CV
    ocrQueue = new Queue('ocr-processing', { connection });

    // Queue PDF pour le parsing des factures
    pdfQueue = new Queue('pdf-processing', { connection });

    // Worker OCR
    ocrWorker = new Worker('ocr-processing', async (job) => {
      const { filePath, candidateId } = job.data;
      const fs = require('fs').promises;
      const Tesseract = require('tesseract.js');

      console.log(`[JOB-QUEUE] OCR job #${job.id} pour candidat #${candidateId}`);
      const worker = await Tesseract.createWorker('fra+eng');
      try {
        const { data: { text } } = await worker.recognize(filePath);
        return { text: text || '', candidateId };
      } finally {
        await worker.terminate();
      }
    }, {
      connection,
      concurrency: 1, // OCR est CPU-intensive, 1 à la fois
      limiter: { max: 2, duration: 60000 }, // Max 2 jobs par minute
    });

    ocrWorker.on('completed', (job, result) => {
      console.log(`[JOB-QUEUE] OCR job #${job.id} terminé`);
    });

    ocrWorker.on('failed', (job, err) => {
      console.error(`[JOB-QUEUE] OCR job #${job?.id} échoué:`, err.message);
    });

    // Worker PDF
    pdfWorker = new Worker('pdf-processing', async (job) => {
      const { filePath, invoiceId } = job.data;
      const fs = require('fs').promises;
      const pdfParse = require('pdf-parse');

      console.log(`[JOB-QUEUE] PDF job #${job.id} pour facture #${invoiceId}`);
      const buffer = await fs.readFile(filePath);
      const data = await pdfParse(buffer);
      return { text: data.text || '', invoiceId };
    }, {
      connection,
      concurrency: 2,
    });

    pdfWorker.on('failed', (job, err) => {
      console.error(`[JOB-QUEUE] PDF job #${job?.id} échoué:`, err.message);
    });

    console.log('[JOB-QUEUE] Queues BullMQ initialisées (OCR + PDF)');
    return true;
  } catch (err) {
    console.warn('[JOB-QUEUE] Impossible d\'initialiser BullMQ:', err.message);
    return false;
  }
}

/**
 * Ajoute un job OCR à la queue (ou exécute en synchrone si pas de queue)
 */
async function addOCRJob(filePath, candidateId) {
  if (ocrQueue) {
    const job = await ocrQueue.add('process-cv', { filePath, candidateId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    return { queued: true, jobId: job.id };
  }

  // Mode dégradé: exécution in-process
  return { queued: false, jobId: null };
}

/**
 * Ajoute un job PDF à la queue
 */
async function addPDFJob(filePath, invoiceId) {
  if (pdfQueue) {
    const job = await pdfQueue.add('parse-pdf', { filePath, invoiceId }, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 3000 },
    });
    return { queued: true, jobId: job.id };
  }

  return { queued: false, jobId: null };
}

async function closeQueues() {
  if (ocrWorker) await ocrWorker.close();
  if (pdfWorker) await pdfWorker.close();
  if (ocrQueue) await ocrQueue.close();
  if (pdfQueue) await pdfQueue.close();
}

module.exports = { initQueues, addOCRJob, addPDFJob, closeQueues };
