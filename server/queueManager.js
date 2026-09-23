/**
 * QueueManager - Manages multi-counter FIFO queues with atomic mutex protection against race conditions.
 */

class SimpleMutex {
  constructor() {
    this.queue = [];
    this.locked = false;
  }

  acquire() {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    } else {
      this.locked = false;
    }
  }

  async runExclusive(taskFn) {
    await this.acquire();
    try {
      return await taskFn();
    } finally {
      this.release();
    }
  }
}

class QueueManager {
  constructor() {
    this.mutex = new SimpleMutex();
    
    // Initial Counter Configuration
    this.counters = {
      'hot-meals': {
        id: 'hot-meals',
        name: 'Hot Meals Counter',
        prefix: 'HM',
        ticketNumberSeq: 100,
        activeQueue: [], // Array of Ticket objects
        servingTicket: null, // Currently called/being prepared
        servedCount: 0,
        totalWaitTimeMs: 0,
        avgPrepTimeMinutes: 3
      },
      'snacks-drinks': {
        id: 'snacks-drinks',
        name: 'Snacks & Drinks Counter',
        prefix: 'SD',
        ticketNumberSeq: 200,
        activeQueue: [],
        servingTicket: null,
        servedCount: 0,
        totalWaitTimeMs: 0,
        avgPrepTimeMinutes: 1.5
      },
      'express-deli': {
        id: 'express-deli',
        name: 'Express Deli & Salad Bar',
        prefix: 'EX',
        ticketNumberSeq: 300,
        activeQueue: [],
        servingTicket: null,
        servedCount: 0,
        totalWaitTimeMs: 0,
        avgPrepTimeMinutes: 2
      }
    };

    this.history = [];
  }

  /**
   * Get public state of all counters
   */
  getState() {
    const countersData = {};
    for (const [id, counter] of Object.entries(this.counters)) {
      countersData[id] = {
        id: counter.id,
        name: counter.name,
        prefix: counter.prefix,
        activeCount: counter.activeQueue.length,
        servingTicket: counter.servingTicket,
        activeQueue: counter.activeQueue.map((ticket, index) => ({
          ...ticket,
          position: index + 1,
          estimatedWaitMinutes: Math.round((index + 1) * counter.avgPrepTimeMinutes * 10) / 10
        })),
        servedCount: counter.servedCount,
        avgWaitMinutes: counter.servedCount > 0 
          ? Math.round((counter.totalWaitTimeMs / counter.servedCount / 60000) * 10) / 10 
          : 0
      };
    }
    return {
      counters: countersData,
      totalActive: Object.values(this.counters).reduce((sum, c) => sum + c.activeQueue.length, 0),
      totalServed: Object.values(this.counters).reduce((sum, c) => sum + c.servedCount, 0),
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Join Queue with Atomic Lock
   */
  async joinQueue({ counterId = 'hot-meals', studentName = 'Student', studentId = '', items = [], notes = '' }) {
    return await this.mutex.runExclusive(async () => {
      const counter = this.counters[counterId];
      if (!counter) {
        throw new Error(`Counter '${counterId}' not found.`);
      }

      counter.ticketNumberSeq += 1;
      const ticketNumber = `${counter.prefix}-${counter.ticketNumberSeq}`;
      const ticketId = `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const now = new Date();

      const ticket = {
        id: ticketId,
        ticketNumber,
        counterId,
        counterName: counter.name,
        studentName: studentName.trim() || 'Anonymous Student',
        studentId: studentId.trim(),
        items: Array.isArray(items) ? items : [items].filter(Boolean),
        notes: notes.trim(),
        joinedAt: now.toISOString(),
        timestampMs: now.getTime(),
        status: 'in_queue'
      };

      counter.activeQueue.push(ticket);

      const position = counter.activeQueue.length;
      const estimatedWaitMinutes = Math.round(position * counter.avgPrepTimeMinutes * 10) / 10;

      const result = {
        ...ticket,
        position,
        estimatedWaitMinutes
      };

      return result;
    });
  }

  /**
   * Cancel/Leave Queue
   */
  async leaveQueue(counterId, ticketId) {
    return await this.mutex.runExclusive(async () => {
      const counter = this.counters[counterId];
      if (!counter) {
        throw new Error(`Counter '${counterId}' not found.`);
      }

      const index = counter.activeQueue.findIndex(t => t.id === ticketId || t.ticketNumber === ticketId);
      if (index === -1) {
        return { success: false, message: 'Ticket not found in active queue' };
      }

      const [removedTicket] = counter.activeQueue.splice(index, 1);
      removedTicket.status = 'cancelled';
      removedTicket.leftAt = new Date().toISOString();
      this.history.push(removedTicket);

      return {
        success: true,
        removedTicket,
        counterId
      };
    });
  }

  /**
   * Staff calls next student in line (Pop FIFO head)
   */
  async serveNext(counterId) {
    return await this.mutex.runExclusive(async () => {
      const counter = this.counters[counterId];
      if (!counter) {
        throw new Error(`Counter '${counterId}' not found.`);
      }

      if (counter.activeQueue.length === 0) {
        return { success: false, message: 'No students waiting in this queue.' };
      }

      // Pop student at front of FIFO line
      const nextTicket = counter.activeQueue.shift();
      const now = new Date();
      nextTicket.status = 'now_serving';
      nextTicket.calledAt = now.toISOString();

      // If previous ticket was serving, archive it
      if (counter.servingTicket) {
        counter.servingTicket.status = 'completed';
        counter.servingTicket.completedAt = now.toISOString();
        this.history.push(counter.servingTicket);
      }

      counter.servingTicket = nextTicket;
      counter.servedCount += 1;

      const waitMs = now.getTime() - nextTicket.timestampMs;
      counter.totalWaitTimeMs += waitMs;

      return {
        success: true,
        ticket: nextTicket,
        counterId,
        remainingInQueue: counter.activeQueue.length
      };
    });
  }

  /**
   * Staff completes current ticket
   */
  async completeTicket(counterId, ticketId, action = 'complete') {
    return await this.mutex.runExclusive(async () => {
      const counter = this.counters[counterId];
      if (!counter) {
        throw new Error(`Counter '${counterId}' not found.`);
      }

      if (counter.servingTicket && (counter.servingTicket.id === ticketId || counter.servingTicket.ticketNumber === ticketId)) {
        const completed = counter.servingTicket;
        completed.status = action === 'no_show' ? 'no_show' : 'completed';
        completed.finishedAt = new Date().toISOString();
        this.history.push(completed);
        counter.servingTicket = null;
        return { success: true, completedTicket: completed };
      }

      return { success: false, message: 'Ticket is not currently being served.' };
    });
  }

  /**
   * Batch simulation for concurrent join test
   */
  async batchConcurrentJoin(counterId, requests = []) {
    const results = await Promise.all(
      requests.map(req => 
        this.joinQueue({
          counterId,
          studentName: req.studentName || 'Simulated Student',
          items: req.items || ['Meal Deal'],
          notes: req.notes || 'Simulated Concurrent Request'
        })
      )
    );
    return results;
  }

  /**
   * Reset all queues for testing/demo
   */
  async resetAll() {
    return await this.mutex.runExclusive(async () => {
      for (const counter of Object.values(this.counters)) {
        counter.activeQueue = [];
        counter.servingTicket = null;
        counter.servedCount = 0;
        counter.totalWaitTimeMs = 0;
        if (counter.id === 'hot-meals') counter.ticketNumberSeq = 100;
        if (counter.id === 'snacks-drinks') counter.ticketNumberSeq = 200;
        if (counter.id === 'express-deli') counter.ticketNumberSeq = 300;
      }
      this.history = [];
      return { success: true };
    });
  }
}

module.exports = new QueueManager();
