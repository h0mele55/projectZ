import { prismaTestClient, resetDatabase } from './db';

// Every integration test starts from an empty database. `--runInBand`
// (jest maxWorkers: 1 on the integration project) makes that safe: a
// parallel worker would truncate another's rows mid-test.
const prisma = prismaTestClient();

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});
