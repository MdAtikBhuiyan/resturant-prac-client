const express = require('express');
const app = express()
const cors = require('cors')
var jwt = require('jsonwebtoken');

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

require('dotenv').config()

// stripe payment method
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)

const port = process.env.PORT || 5000;

// middleware
app.use(cors())
app.use(express.json())



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bbvd3eh.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {

    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        const database = client.db("bistroResturantDB");
        const menuCollection = database.collection("menu");

        const reviewsCollection = database.collection("reviews");
        const cartCollection = database.collection("carts");
        const userCollection = database.collection("users");
        const paymentCollection = database.collection("payments");

        // jwt related api

        app.post('/jwt', async (req, res) => {

            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN, { expiresIn: '1h' });
            res.send({ token })
        })

        // middleware
        const verifyToken = (req, res, next) => {
            console.log("inside verifytoken", req.headers.authorization);
            if (!req?.headers?.authorization) {
                return res.status(401).send({ message: "unauthorized access" })
            }
            const token = req?.headers?.authorization.split(" ")[1];

            jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
                if (err) {
                    return res.status(401).send({ message: "unauthorized access" })
                }
                req.decoded = decoded;
                next();
            });
        }

        // use verify admin after verify token
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;

            const query = { email: email }
            const user = await userCollection.findOne(query)

            const isAdmin = user?.role === 'admin'
            if (!isAdmin) {
                return res.status(403).send({ message: "forbidden access" })
            }
            next();
        }


        // user related api

        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {

            // console.log("token at header for users", req.headers);

            const result = await userCollection.find().toArray()
            res.send(result)
        })

        app.get('/users/admin/:email', verifyToken, async (req, res) => {

            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: "forbidden access" })
            }

            const query = { email: email }
            const user = await userCollection.findOne(query)

            let isAdmin = false;
            if (user) {
                isAdmin = user?.role === 'admin'
            }
            console.log("admin", isAdmin);
            res.send({ isAdmin })
        })

        app.post('/users', async (req, res) => {

            const user = req.body;

            // insert email if user doesn't exist
            // you can do this many ways (1. email unique, 2. upsert 3. simple checking)

            const query = { email: user.email }
            const isExist = await userCollection.findOne(query)

            if (isExist) {
                return res.send({ message: "user already exist", insertedId: null })
            }

            const result = await userCollection.insertOne(user)
            res.send(result)
        })


        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {

            const id = req.params.id;

            const filter = { _id: new ObjectId(id) }

            const updatedDoc = {
                $set: {
                    role: "admin"
                }
            }

            const result = await userCollection.updateOne(filter, updatedDoc)
            res.send(result)

        })

        app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;

            const query = { _id: new ObjectId(id) }
            const result = await userCollection.deleteOne(query)
            res.send(result)

        })

        // menu related apis

        app.get('/menu', async (req, res) => {
            const result = await menuCollection.find().toArray()
            res.send(result)
        })

        app.get('/reviews', async (req, res) => {
            const result = await reviewsCollection.find().toArray()
            res.send(result)
        })

        app.get('/menu/:id', async (req, res) => {
            const id = req.params.id;
            console.log("id", id);
            const query = { _id: new ObjectId(id) }
            console.log(query);
            const result = await menuCollection.findOne(query)
            // const result = await menuCollection.findOne({ _id: id })
            res.send(result)
        })

        app.post('/menu', verifyToken, verifyAdmin, async (req, res) => {
            const item = req.body;
            const result = await menuCollection.insertOne(item)
            res.send(result)
        })

        app.patch('/menu/:id', async (req, res) => {
            const item = req.body;
            const id = req.params.id;

            const filter = { _id: new ObjectId(id) }

            const updatedDoc = {
                $set: {
                    name: item.name,
                    category: item.category,
                    price: item.price,
                    recipe: item.recipe,
                    image: item.image
                }
            }

            const result = await menuCollection.updateOne(filter, updatedDoc)
            res.send(result)
        })

        app.delete('/menu/:id', verifyToken, verifyAdmin, async (req, res) => {

            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const result = await menuCollection.deleteOne(query)
            res.send(result)

        })



        // carts collection

        app.get('/carts', async (req, res) => {

            const email = req?.query?.email;

            const query = { email: email }

            const result = await cartCollection.find(query).toArray()
            res.send(result)

        })

        app.post('/carts', async (req, res) => {

            const cartItem = req.body;
            const result = await cartCollection.insertOne(cartItem)
            res.send(result)
        })

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const result = await cartCollection.deleteOne(query)
            res.send(result)
        })


        // stripe payment intent
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            // count money as posha , 5tk means 500 poisha
            const amount = parseInt(price * 100);

            console.log("stripe amount", amount);

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: [
                    "card"
                ],
            })

            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })


        app.post('/payments', async (req, res) => {
            const paymentInfo = req.body;
            console.log("payment info", paymentInfo);

            const paymentResult = await paymentCollection.insertOne(paymentInfo)

            // delete each item from the cart
            const query = {
                _id: {
                    $in: paymentInfo.cartIds.map(id => new ObjectId(id))
                }
            }
            const deleteResult = await cartCollection.deleteMany(query);

            res.send({ paymentResult, deleteResult })

        })

        app.get('/payments/:email', verifyToken, async (req, res) => {

            const query = { email: req.params?.email }

            if (req.params?.email !== req.decoded?.email) {
                return res.status(403).send({ message: "forbidden access" })
            }

            const result = await paymentCollection.find(query).toArray()
            res.send(result)
        })

        // stats or analytics

        app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {

            const users = await userCollection.estimatedDocumentCount();
            const menuItems = await menuCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();

            // revenue this is not the best way

            // const payments = await paymentCollection.find().toArray()
            // const revenue = payments.reduce((total, item) => total + item.price, 0)

            const result = await paymentCollection.aggregate([
                {
                    $group: {
                        _id: null, // for all collected datas
                        totalRevenue: {
                            $sum: '$price', // price is a property of obj
                        }
                    }
                },
            ]).toArray()

            const revenue = result.length > 0 ? result[0].totalRevenue : 0;

            res.send({
                users,
                menuItems,
                orders,
                revenue
            })

        })

        // using aggregate pipeline for using many data collection together



        app.get("/order-stats", verifyToken, verifyAdmin, async (req, res) => {

            const result = await paymentCollection.aggregate([
                // split the paymentcollection menuIDs array field into separate documents
                {
                    $unwind: '$menuIds'
                },
                // convert menuIds value to ObjectId type
                {
                    $addFields: {
                        menuIdObject: { $toObjectId: '$menuIds' } // Convert menuIds to ObjectId
                    }
                },
                // join to menu collection's _id and paymentCollection's menuIds
                {
                    $lookup: {
                        from: 'menu',
                        localField: 'menuIdObject',
                        // let: { menuId: { $toObjectId: '$menuIds' } },
                        // pipeline: [
                        //     {
                        //         $match: {
                        //             $expr: { $eq: ['$_id', '$$menuId'] }
                        //         }
                        //     }
                        // ],
                        foreignField: '_id',
                        as: "menuItems", // give an array of matching _id's data from menu collection with array name menuItems
                    }
                },
                {
                    $unwind: '$menuItems', // split array items to single object of menu
                },
                // category wise group
                {
                    $group: {
                        _id: '$menuItems.category',
                        quantity: { $sum: 1 },
                        totalRevenue: { $sum: "$menuItems.price" }
                    }
                },
                // je je field dekhte chao ar jevabe dekhte chao sevabe modify korar jnne
                {
                    $project: {
                        _id: 0,
                        category: "$_id",
                        quantity: 1,
                        revenue: '$totalRevenue'
                    }
                }
            ]).toArray()

            res.send(result)

        })


        // another way to convert and match object id
        // {
        //     $lookup: {
        //         from: 'menu',
        //         let: { menuId: { $toObjectId: '$menuIds' } },
        //         pipeline: [
        //             {
        //                 $match: {
        //                     $expr: { $eq: ['$_id', '$$menuId'] }
        //                 }
        //             }
        //         ],
        //         as: "menuItems"
        //     }
        // }



        // example
        // for same data type field matching join
        app.get("/path", async (req, res) => {

            const result = await paymentCollection.aggregate([
                // split the paymentcollection menuIDs array field into separate documents
                {
                    $unwind: '$menuIds'
                },
                // join to menu collection's _id and paymentCollection's menuIds
                {
                    $lookup: {
                        from: 'menu',
                        localField: 'menuIds',
                        foreignField: '_id',
                        as: "menuItems", // give an array of matching _id's data from menu collection with array name menuItems
                    }
                }
            ]).toArray()

            res.send(result)

        })










        // order status
        /**
         * ----------------------------
         *    NON-Efficient Way
         * ------------------------------
         * 1. load all the payments
         * 2. for every menuItemIds (which is an array), go find the item from menu collection
         * 3. for every item in the menu collection that you found from a payment entry (document)
        */








        // example: revenue
        // const aggregationPipeline = [
        //     {
        //         $group: {
        //             _id: null,
        //             totalRevenue: { $sum: "$price" }
        //         }
        //     }
        // ];

        // const result = await paymentCollection.aggregate(aggregationPipeline).toArray();
        // const totalRevenue = result.length > 0 ? result[0].totalRevenue : 0;

        // console.log("Total Revenue:", totalRevenue);


        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send("Boss is sitting...")
})


app.listen(port, () => {
    console.log(`Bistro boss is sitting on port`, port);
})