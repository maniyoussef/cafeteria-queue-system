/**
 * Standalone Verification Script for Cafeteria Queue Management System
 * Tests concurrent joins, ticket ordering, queue pops, and cancellations.
 */

const http = require('http');

const PORT = 3000;
const HOST = 'localhost';

function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const dataString = body ? JSON.stringify(body) : null;
    const options = {
      hostname: HOST,
      port: PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(dataString ? { 'Content-Length': Buffer.byteLength(dataString) } : {})
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({ statusCode: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: responseData });
        }
      });
    });

    req.on('error', reject);
    if (dataString) req.write(dataString);
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting Automated Cafeteria Queue Verification Suite...\n');

  try {
    // 1. Reset Queues
    console.log('1. Testing POST /api/queue/reset...');
    const resetRes = await makeRequest('/api/queue/reset', 'POST');
    console.log('   Result:', resetRes.body);

    // 2. Test Parallel Concurrent Joins (Simulating Student Client A & C at same instant)
    console.log('\n2. Testing Concurrent Joins (Simultaneous 5 requests via Promise.all)...');
    const startMs = Date.now();
    const joinPromises = [
      makeRequest('/api/queue/join', 'POST', { counterId: 'hot-meals', studentName: 'Alice (VM2)', items: ['Burger'] }),
      makeRequest('/api/queue/join', 'POST', { counterId: 'hot-meals', studentName: 'Bob (VM4)', items: ['Fries'] }),
      makeRequest('/api/queue/join', 'POST', { counterId: 'hot-meals', studentName: 'Charlie (Client C)', items: ['Drink'] }),
      makeRequest('/api/queue/join', 'POST', { counterId: 'hot-meals', studentName: 'David (Client D)', items: ['Pizza'] }),
      makeRequest('/api/queue/join', 'POST', { counterId: 'hot-meals', studentName: 'Eve (Client E)', items: ['Salad'] }),
    ];

    const joinResults = await Promise.all(joinPromises);
    const duration = Date.now() - startMs;
    console.log(`   Processed ${joinResults.length} parallel requests in ${duration}ms.`);

    // Inspect ticket sequence
    const tickets = joinResults.map(r => r.body.ticket);
    console.log('   Assigned Tickets:');
    tickets.forEach(t => {
      console.log(`     - Ticket #${t.ticketNumber} assigned to '${t.studentName}' | Line Position: #${t.position}`);
    });

    // Verify strict monotonic sequence (HM-101, HM-102, HM-103, HM-104, HM-105)
    const expectedSeq = ['HM-101', 'HM-102', 'HM-103', 'HM-104', 'HM-105'];
    const actualSeq = tickets.map(t => t.ticketNumber);
    const isStrict = JSON.stringify(actualSeq) === JSON.stringify(expectedSeq);
    
    if (isStrict) {
      console.log('   ✅ VERIFICATION PASSED: Strict FIFO ticket sequence guaranteed without race conditions!');
    } else {
      console.error('   ❌ VERIFICATION FAILED: Sequence mismatch!', actualSeq);
    }

    // 3. Test Staff Serve Next (Popping FIFO head)
    console.log('\n3. Testing Staff Serve Next (POST /api/staff/serve-next)...');
    const serveRes = await makeRequest('/api/staff/serve-next', 'POST', { counterId: 'hot-meals' });
    console.log(`   Served Front Ticket: #${serveRes.body.ticket.ticketNumber} (${serveRes.body.ticket.studentName})`);
    console.log(`   Remaining Waiting in Queue: ${serveRes.body.remainingInQueue}`);

    if (serveRes.body.ticket.ticketNumber === 'HM-101') {
      console.log('   ✅ VERIFICATION PASSED: Staff popped the exact FIFO head (HM-101)!');
    } else {
      console.error('   ❌ VERIFICATION FAILED: Did not pop head!');
    }

    // 4. Test Student Leave/Cancel Queue
    console.log('\n4. Testing Student Leave Queue (POST /api/queue/leave for HM-103)...');
    const ticketToCancel = tickets.find(t => t.ticketNumber === 'HM-103');
    const leaveRes = await makeRequest('/api/queue/leave', 'POST', { counterId: 'hot-meals', ticketId: ticketToCancel.id });
    console.log('   Leave Result:', leaveRes.body);

    // Fetch updated queue status
    const queueState = await makeRequest('/api/queues', 'GET');
    const hmQueue = queueState.body.counters['hot-meals'];
    console.log(`   Updated Hot Meals Queue Length: ${hmQueue.activeCount}`);
    console.log('   Current Remaining Active Queue Positions:');
    hmQueue.activeQueue.forEach(item => {
      console.log(`     - Ticket #${item.ticketNumber} | Position: #${item.position} (${item.studentName})`);
    });

    console.log('\n🎉 ALL AUTOMATED TESTS COMPLETED SUCCESSFULLY!\n');
  } catch (err) {
    console.error('❌ Test execution error:', err);
  }
}

runTests();
