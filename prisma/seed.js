import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const stores = [
  { name: "Verve Outdoor", slug: "verve-outdoor", domain: "verveoutdoor.com" },
  { name: "Luna Home Co", slug: "luna-home-co", domain: "lunahome.co" },
];

const productCatalog = [
  [
    { name: "Summit Insulated Bottle", slug: "summit-insulated-bottle", description: "Keeps drinks cold for 24 hours." },
    { name: "Trail Pack 28L", slug: "trail-pack-28l", description: "Lightweight day pack with premium straps." },
    { name: "Stormproof Camping Lantern", slug: "stormproof-camping-lantern", description: "Rechargeable all-weather lantern." },
    { name: "Glacier Merino Hoodie", slug: "glacier-merino-hoodie", description: "Temperature balancing merino layer." },
  ],
  [
    { name: "Atlas Linen Bedding Set", slug: "atlas-linen-bedding-set", description: "Stonewashed linen for year-round comfort." },
    { name: "Halo Ceramic Vase", slug: "halo-ceramic-vase", description: "Handcrafted matte finish centerpiece." },
    { name: "North Oak Dining Chair", slug: "north-oak-dining-chair", description: "Solid oak frame with woven seat." },
    { name: "Cirrus Ambient Lamp", slug: "cirrus-ambient-lamp", description: "Warm dimmable light for living rooms." },
  ],
];

const firstNames = [
  "Avery", "Jordan", "Sofia", "Mason", "Elena", "Riley", "Kai", "Noah", "Priya", "Camila",
  "Liam", "Mila", "Ethan", "Harper", "Lucas", "Aaliyah", "Owen", "Isla", "Leo", "Maeve",
  "Aria", "Ezra", "Nora", "Theo", "Ivy", "Aiden", "Zara", "Finn", "Layla", "Roman",
];

const reviewTitles = [
  "Exceeded expectations", "Solid quality and easy to use", "Great value for the price", "Looks even better in person",
  "Support team was incredibly helpful", "Would absolutely buy again", "Almost perfect for daily use", "Reliable and well designed",
  "A noticeable upgrade", "Fast delivery and premium packaging",
];

const reviewBodies = [
  "I have been using this for two weeks and it has held up really well. The build quality is excellent and the details feel premium.",
  "Setup took less than five minutes and everything worked immediately. This solved the exact problem I had with my previous option.",
  "The fit and finish are excellent. I appreciate the thoughtful design touches and the overall durability.",
  "I bought this after reading other reviews and I can confirm it is worth it. Customer support answered my question quickly too.",
  "Shipping was fast and the product feels exactly like what was described. I would recommend this to friends.",
  "This has become part of my daily routine. It performs consistently and still looks brand new.",
  "I had one small issue at first, but it was easy to resolve. Overall, I am very happy with the purchase.",
  "The materials feel premium and the design fits my space perfectly. I am planning to order another one.",
  "It feels thoughtfully made and not generic at all. The experience from unboxing to daily use has been excellent.",
  "After testing for a month, I can say it is dependable. This is one of the better purchases I have made this year.",
];

const statuses = ["pending", "approved", "approved", "approved", "rejected"];

const photoPool = [
  "https://images.unsplash.com/photo-1460353581641-37baddab0fa2?w=600&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=600&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=600&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1493666438817-866a91353ca9?w=600&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1489515217757-5fd1be406fef?w=600&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=600&auto=format&fit=crop",
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem(items) {
  return items[randomInt(0, items.length - 1)];
}

function randomDateWithinMonths(monthsBack = 4) {
  const now = Date.now();
  const span = monthsBack * 30 * 24 * 60 * 60 * 1000;
  return new Date(now - randomInt(0, span));
}

function buildCustomer(index) {
  const firstName = firstNames[index % firstNames.length];
  const lastInitial = String.fromCharCode(65 + (index % 26));
  const name = `${firstName} ${lastInitial}.`;
  const emailHandle = `${firstName.toLowerCase()}${index + 10}`;
  return {
    name,
    email: `${emailHandle}@example.com`,
  };
}

async function main() {
  await prisma.review.deleteMany({});
  await prisma.reviewRequest.deleteMany({});
  await prisma.widget.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.store.deleteMany({});

  const createdStores = [];

  for (const storeInput of stores) {
    const store = await prisma.store.create({ data: storeInput });
    createdStores.push(store);
  }

  const allProducts = [];

  for (let i = 0; i < createdStores.length; i += 1) {
    const store = createdStores[i];
    for (const productInput of productCatalog[i]) {
      const product = await prisma.product.create({
        data: {
          ...productInput,
          storeId: store.id,
        },
      });
      allProducts.push(product);
    }
  }

  for (let i = 0; i < 30; i += 1) {
    const customer = buildCustomer(i);
    const product = randomItem(allProducts);
    const includePhoto = i % 3 !== 0;
    const photoUrls = includePhoto
      ? [randomItem(photoPool), randomItem(photoPool)].filter((value, idx, arr) => arr.indexOf(value) === idx).join(",")
      : null;

    await prisma.review.create({
      data: {
        storeId: product.storeId,
        productId: product.id,
        authorName: customer.name,
        authorEmail: customer.email,
        rating: randomInt(2, 5),
        title: randomItem(reviewTitles),
        body: randomItem(reviewBodies),
        verifiedPurchase: i % 4 !== 0,
        status: randomItem(statuses),
        photoUrls,
        createdAt: randomDateWithinMonths(5),
      },
    });
  }

  for (let i = 0; i < 10; i += 1) {
    const customer = buildCustomer(100 + i);
    const product = randomItem(allProducts);

    await prisma.reviewRequest.create({
      data: {
        storeId: product.storeId,
        productId: product.id,
        email: customer.email,
        name: customer.name,
        requestToken: `req_${Math.random().toString(36).slice(2, 10)}`,
        status: i % 3 === 0 ? "sent" : i % 4 === 0 ? "opened" : "pending",
        createdAt: randomDateWithinMonths(2),
      },
    });
  }

  console.log("Seed complete: 2 stores, 8 products, 30 reviews, 10 review requests.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
