require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

const app = express();

const allowedOrigins = [
  process.env.CLIENT_URI ? process.env.CLIENT_URI.replace(/\/$/, "") : "",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      const sanitized = origin.replace(/\/$/, "");
      if (allowedOrigins.includes(sanitized)) {
        callback(null, true);
      } else {
        callback(new Error("CORS blocked"));
      }
    },
    credentials: true,
  }),
);

app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASS}@cluster0.cmdrutm.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db, petsCollection, requestCollection;

async function getDB() {
  if (!db) {
    await client.connect();
    db = client.db("rescume");
    petsCollection = db.collection("pets");
    requestCollection = db.collection("requests");
  }
  return { petsCollection, requestCollection };
}

const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: Missing token" });
  }
  const token = authHeader.split(" ")[1];

  try {
    const jwksUrl = `${process.env.CLIENT_URI.replace(/\/$/, "")}/api/auth/jwks`;
    const JWKS = createRemoteJWKSet(new URL(jwksUrl));
    const { payload } = await jwtVerify(token, JWKS);
    req.user = { email: payload.email };
    next();
  } catch (error) {
    return res.status(403).json({ message: "Forbidden: Invalid token" });
  }
};

app.get("/", (req, res) => res.send("Rescume API Online"));

app.get("/pets", async (req, res) => {
  const { petsCollection } = await getDB();
  const { name, species } = req.query;
  let query = {};
  if (name) query.petName = { $regex: name, $options: "i" };
  if (species) query.species = { $in: species.split(",") };

  const result = await petsCollection.find(query).toArray();
  res.send(result);
});

app.get("/pets/:id", verifyToken, async (req, res) => {
  const { petsCollection } = await getDB();
  const result = await petsCollection.findOne({
    _id: new ObjectId(req.params.id),
  });
  res.send(result);
});

app.post("/pets", verifyToken, async (req, res) => {
  const { petsCollection } = await getDB();
  const newPet = {
    ...req.body,
    ownerEmail: req.user.email,
    status: "available",
  };
  const result = await petsCollection.insertOne(newPet);
  res.send(result);
});

app.delete("/pets/:id", verifyToken, async (req, res) => {
  const { petsCollection } = await getDB();
  const result = await petsCollection.deleteOne({
    _id: new ObjectId(req.params.id),
    ownerEmail: req.user.email,
  });
  res.send(result);
});

app.patch("/pets/:id", verifyToken, async (req, res) => {
  const { petsCollection } = await getDB();
  const result = await petsCollection.updateOne(
    { _id: new ObjectId(req.params.id), ownerEmail: req.user.email },
    { $set: req.body },
  );
  res.send(result);
});

app.get("/requests", verifyToken, async (req, res) => {
  const { requestCollection } = await getDB();
  const result = await requestCollection
    .find({ applicantEmail: req.user.email })
    .toArray();
  res.send(result);
});

app.get("/incoming-requests", verifyToken, async (req, res) => {
  const { petsCollection, requestCollection } = await getDB();
  const myPets = await petsCollection
    .find({ ownerEmail: req.user.email })
    .toArray();
  const myPetIds = myPets.map((p) => p._id.toString());
  const result = await requestCollection
    .find({ petId: { $in: myPetIds } })
    .toArray();
  res.send(result);
});

app.post("/requests", verifyToken, async (req, res) => {
  const { petsCollection, requestCollection } = await getDB();
  const targetPet = await petsCollection.findOne({
    _id: new ObjectId(req.body.petId),
  });
  if (!targetPet) return res.status(404).json({ message: "Pet not found" });
  if (targetPet.ownerEmail === req.user.email)
    return res.status(403).json({ message: "Cannot adopt own pet" });

  const result = await requestCollection.insertOne({
    ...req.body,
    applicantEmail: req.user.email,
  });
  res.send(result);
});

app.patch("/requests/:id", verifyToken, async (req, res) => {
  const { petsCollection, requestCollection } = await getDB();
  const requestId = new ObjectId(req.params.id);
  const updateResult = await requestCollection.updateOne(
    { _id: requestId },
    { $set: req.body },
  );

  if (req.body.status?.toLowerCase() === "approved") {
    const reqDoc = await requestCollection.findOne({ _id: requestId });
    await petsCollection.updateOne(
      { _id: new ObjectId(reqDoc.petId) },
      { $set: { status: "adopted" } },
    );
    await requestCollection.updateMany(
      { petId: reqDoc.petId, _id: { $ne: requestId } },
      { $set: { status: "Rejected" } },
    );
  }
  res.send(updateResult);
});

app.delete("/requests/:id", verifyToken, async (req, res) => {
  try {
    const { requestCollection } = await getDB();
    const requestId = new ObjectId(req.params.id);
    const userEmail = req.user.email;
    const result = await requestCollection.deleteOne({
      _id: requestId,
      applicantEmail: userEmail,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        message: "Request not found or you don't have permission to delete it.",
      });
    }

    res.send({ message: "Request deleted successfully", result });
  } catch (error) {
    console.error("Delete Request Error:", error);
    res.status(500).json({ message: "Failed to delete the request." });
  }
});

if (process.env.NODE_ENV !== "production") {
  app.listen(5000, () => console.log("Local Server running on 5000"));
}

module.exports = app;
