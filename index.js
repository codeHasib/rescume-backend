require("dotenv").config();

const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(express.json());

const SERVER_PORT = 5000;

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASS}@cluster0.cmdrutm.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URI}/api/auth/jwks`),
);

const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = { email: payload.email };
    next();
  } catch (error) {
    console.error("JWT Verification Error:", error.message);
    return res.status(403).json({ message: "Forbidden" });
  }
};

async function run() {
  try {
    const db = client.db("rescume");
    const petsCollection = db.collection("pets");
    const requestCollection = db.collection("requests");

    app.get("/", (req, res) => {
      res.send("Hello pet lovers");
    });

    app.get("/pets", async (req, res) => {
      const cursor = petsCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/pets/:id", verifyToken, async (req, res) => {
      const query = {
        _id: new ObjectId(req.params.id),
      };
      const result = await petsCollection.findOne(query);
      res.send(result);
    });

    app.post("/pets", verifyToken, async (req, res) => {
      const newPet = req.body;
      newPet.ownerEmail = req.user.email;
      newPet.status = "available";
      const result = await petsCollection.insertOne(newPet);
      res.send(result);
    });

    app.delete("/pets/:id", verifyToken, async (req, res) => {
      const query = {
        _id: new ObjectId(req.params.id),
        ownerEmail: req.user.email,
      };
      const result = await petsCollection.deleteOne(query);
      res.send(result);
    });

    app.patch("/pets/:id", verifyToken, async (req, res) => {
      const query = {
        _id: new ObjectId(req.params.id),
        ownerEmail: req.user.email,
      };
      const updatedPet = req.body;
      const result = await petsCollection.updateOne(query, {
        $set: updatedPet,
      });
      res.send(result);
    });

    app.get("/requests", verifyToken, async (req, res) => {
      try {
        const userEmail = req.user.email;
        const query = { applicantEmail: userEmail };
        const cursor = requestCollection.find(query);
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get("/incoming-requests", verifyToken, async (req, res) => {
      try {
        const ownerEmail = req.user.email;
        const myPets = await petsCollection
          .find({ ownerEmail: ownerEmail })
          .toArray();
        const myPetIds = myPets.map((pet) => pet._id.toString());
        const query = { petId: { $in: myPetIds } };

        const cursor = requestCollection.find(query);
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.post("/requests", verifyToken, async (req, res) => {
      const newRequest = req.body;

      const petQuery = { _id: new ObjectId(newRequest.petId) };
      const targetPet = await petsCollection.findOne(petQuery);

      if (!targetPet) {
        return res.status(404).json({ message: "Pet not found" });
      }

      if (targetPet.ownerEmail === req.user.email) {
        return res
          .status(403)
          .json({ message: "You cannot adopt your own listed pet" });
      }

      newRequest.applicantEmail = req.user.email;
      const result = await requestCollection.insertOne(newRequest);
      res.send(result);
    });

    app.delete("/requests/:id", verifyToken, async (req, res) => {
      const query = {
        _id: new ObjectId(req.params.id),
        applicantEmail: req.user.email,
      };
      const result = await requestCollection.deleteOne(query);
      res.send(result);
    });

    app.patch("/requests/:id", verifyToken, async (req, res) => {
      try {
        const requestId = req.params.id;
        const updatedRequest = req.body;

        const requestQuery = { _id: new ObjectId(requestId) };

        const requestUpdateResult = await requestCollection.updateOne(
          requestQuery,
          {
            $set: updatedRequest,
          },
        );

        if (updatedRequest.status?.toLowerCase() === "approved") {
          const currentRequest = await requestCollection.findOne(requestQuery);

          if (currentRequest && currentRequest.petId) {
            
            await petsCollection.updateOne(
              { _id: new ObjectId(currentRequest.petId) },
              { $set: { status: "adopted" } },
            );
            await requestCollection.updateMany(
              {
                petId: currentRequest.petId,
                _id: { $ne: new ObjectId(requestId) },
              },
              { $set: { status: "Rejected" } },
            );
          }
        }

        res.send(requestUpdateResult);
      } catch (error) {
        res.status(500).send({ message: "Failed to update request pipelines" });
      }
    });
  } finally {
  }
}
run().catch(console.dir);

app.listen(SERVER_PORT, console.log(`${SERVER_PORT} is listening on port`));
