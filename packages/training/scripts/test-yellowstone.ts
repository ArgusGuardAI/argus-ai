/**
 * Test Yellowstone gRPC connection
 */
import 'dotenv/config';

async function main() {
  let endpoint = process.env.YELLOWSTONE_ENDPOINT?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  // Ensure port 443 is specified for TLS
  if (endpoint && !endpoint.includes(':')) {
    endpoint = endpoint + ':443';
  }
  const token = process.env.YELLOWSTONE_TOKEN;

  console.log('Testing Yellowstone gRPC connection...');
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Token: ${token?.slice(0, 8)}...`);

  // Dynamic import to handle ESM/CJS issues
  const YellowstoneModule = await import('@triton-one/yellowstone-grpc');
  const Client = (YellowstoneModule as any).default || YellowstoneModule;
  const CommitmentLevel = (YellowstoneModule as any).CommitmentLevel || (Client as any).CommitmentLevel;

  console.log('\nClient constructor type:', typeof Client);
  console.log('CommitmentLevel:', CommitmentLevel);

  try {
    const client = new Client(endpoint, token, {
      grpcMaxDecodingMessageSize: 64 * 1024 * 1024,
    });

    console.log('\nClient created, attempting connect...');
    await client.connect();
    console.log('Connected!');

    const stream = await client.subscribe();
    console.log('Stream created!');

    // Simple ping subscription
    stream.write({
      accounts: {},
      slots: {},
      transactions: {},
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      accountsDataSlice: [],
      ping: { id: 1 },
    });

    console.log('Ping sent, waiting for response...');

    stream.on('data', (update: any) => {
      if (update.pong) {
        console.log('Pong received! Connection working.');
        process.exit(0);
      }
    });

    stream.on('error', (err: Error) => {
      console.error('Stream error:', err.message);
      console.error('Full error:', err);
    });

    // Timeout after 10s
    setTimeout(() => {
      console.error('Timeout - no response after 10s');
      process.exit(1);
    }, 10000);

  } catch (err) {
    console.error('Connection failed:', err);
    process.exit(1);
  }
}

main();
