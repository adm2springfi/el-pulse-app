const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Create a test user
  const user = await prisma.user.upsert({
    where: { email: 'leroy@example.com' },
    update: {},
    create: {
      email: 'leroy@example.com',
      name: 'Leroy Springfield',
      password: 'password123',
      role: 'ADMIN',
    },
  });

  // Create sample events tailored for East London
  const event1 = await prisma.event.create({
    data: {
      title: 'EL Beach Music Festival',
      description: 'An epic outdoor live music and Amapiano experience by the coast in East London.',
      location: 'Nahoon Beach, East London',
      date: new Date('2026-11-15T14:00:00Z'),
      price: 150.00,
      capacity: 500,
    },
  });

  const event2 = await prisma.event.create({
    data: {
      title: 'Tech & Cloud Meetup East London',
      description: 'Networking and lightning talks on AWS, Terraform, and modern systems administration.',
      location: 'Beacon Bay Hub, East London',
      date: new Date('2026-11-20T18:00:00Z'),
      price: 50.00,
      capacity: 100,
    },
  });

  console.log('🌱 Seed data inserted successfully:', { user: user.name, events: [event1.title, event2.title] });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });