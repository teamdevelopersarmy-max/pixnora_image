import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import mongoose from 'mongoose';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import multer from 'multer';
import fs from 'fs';

const ak = "0000000000";

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

function generateEncryptedKey(base = ak) {
  const salt = uuidv4().replace(/-/g, '').substring(0, 12);
  const hash = crypto.createHmac('sha256', base)
    .update(salt)
    .digest('hex')
    .substring(0, 24);
  return `ak_${base}${hash}`;
}

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://itsnexverra_db_user:kUhTkKBwsN2EEeoo@cluster0.iaz9eus.mongodb.net/?appName=Cluster0';
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');

// --- MongoDB Schemas ---
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  phone: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  address: { type: String },
  cart: [{
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    quantity: { type: Number, default: 1 }
  }]
});

const apiKeySchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  key: { type: String, unique: true, required: true },
  name: { type: String },
  created_at: { type: Date, default: Date.now },
  revoked: { type: Boolean, default: false }
});

const clonedEndpointSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  original_url: { type: String, required: true },
  cloned_path: { type: String, unique: true, required: true },
  created_at: { type: Date, default: Date.now }
});

const productSchema = new mongoose.Schema({
  thumbnail: { type: String },
  title: { type: String, required: true },
  original_price: { type: Number, required: true },
  offer_price: { type: Number, required: true },
  discount_percentage: { type: Number },
  items: { type: Number },
  rating: { type: String, default: '9.5' },
  category: { type: String, default: 'AI Model' },
  type: { type: String, enum: ['API', 'Model', 'SOFTWARE'] },
  zip_url: { type: String },
  published: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});

const orderSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  full_name: { type: String },
  email: { type: String },
  phone: { type: String },
  address: { type: String },
  total_price: { type: Number },
  status: { type: String, default: 'pending' },
  transaction_id: { type: String },
  created_at: { type: Date, default: Date.now }
});

const orderItemSchema = new mongoose.Schema({
  order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  price: { type: Number }
});

const modelPresetSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  data: { type: Map, of: String, required: true },
  created_at: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const ApiKey = mongoose.model('ApiKey', apiKeySchema);
const ClonedEndpoint = mongoose.model('ClonedEndpoint', clonedEndpointSchema);
const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const OrderItem = mongoose.model('OrderItem', orderItemSchema);
const ModelPreset = mongoose.model('ModelPreset', modelPresetSchema);

async function startServer() {
  // Connect to MongoDB
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }

  const app = express();
  app.set('trust proxy', 1);
  const PORT = 10000;

  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());
  app.use('/uploads', express.static(uploadsDir));

  // Session Setup
  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: MONGODB_URI,
      collectionName: 'sessions'
    }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      httpOnly: true
    }
  }));

  // Request logging
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Bootstrap Data
  const bootstrapData = async () => {
    // Admin User
    const adminEmail = 'itsdevelopersarmy@gmail.com';
    const adminPassword = '123@Rahul';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    
    let existingAdmin = await User.findOne({ email: adminEmail });
    if (!existingAdmin) {
      console.log('Bootstrapping admin user...');
      existingAdmin = await User.create({
        name: 'Admin',
        email: adminEmail,
        phone: '0000000000',
        password: hashedPassword,
        role: 'admin'
      });
      
      const initialKey = generateEncryptedKey();
      await ApiKey.create({ user_id: existingAdmin._id, key: initialKey, name: 'Admin Key' });
    } else {
      existingAdmin.password = hashedPassword;
      existingAdmin.role = 'admin';
      await existingAdmin.save();
    }

    // Products
    const initialProducts = [
      {
        title: 'DREAM FORGE IMAGE',
        original_price: 1999,
        offer_price: 999,
        discount_percentage: 50,
        items: 100,
        type: 'Model',
        published: true,
        thumbnail: 'https://picsum.photos/seed/dreamforge/400/300'
      },
      {
        title: 'Pixnora Image Model',
        original_price: 2999,
        offer_price: 1499,
        discount_percentage: 50,
        items: 50,
        type: 'Model',
        published: true,
        thumbnail: 'https://picsum.photos/seed/pixnora/400/300'
      }
    ];

    for (const p of initialProducts) {
      const exists = await Product.findOne({ title: p.title });
      if (!exists) {
        console.log(`Bootstrapping product: ${p.title}`);
        await Product.create(p);
      }
    }
  };
  await bootstrapData();

  const apiRouter = express.Router();

  apiRouter.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url });
  });

  // Middleware to verify Session
  const authenticateToken = (req, res, next) => {
    if (!req.session.user) {
      console.log(`[Auth] Unauthorized access attempt to ${req.url}`);
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = req.session.user;
    console.log(`[Auth] Authenticated user: ${req.user.email} (${req.user.role})`);
    next();
  };
  
  const isAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') {
      console.log(`[Auth] Forbidden: Admin access required for ${req.url}. User role: ${req.user?.role}`);
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  };

  // Auth Routes
  apiRouter.post('/auth/signup', async (req, res) => {
    const { name, email, phone, password } = req.body;
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const role = email === 'itsdevelopersarmy@gmail.com' ? 'admin' : 'user';
      
      const newUser = await User.create({ name, email, phone, password: hashedPassword, role });

      // Automatically generate initial API key
      const initialKey = generateEncryptedKey();
      await ApiKey.create({ user_id: newUser._id, key: initialKey, name: 'Initial Key' });

      res.status(201).json({ message: 'User created', userId: newUser._id });
    } catch (error) {
      console.error('Signup Error:', error);
      res.status(400).json({ error: 'User already exists or invalid data' });
    }
  });

  apiRouter.post('/auth/login', async (req, res) => {
    const { identifier, password } = req.body;
    const user = await User.findOne({ $or: [{ email: identifier }, { phone: identifier }] });
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.user = { 
      id: user._id, 
      email: user.email, 
      name: user.name, 
      role: user.role, 
      phone: user.phone, 
      address: user.address 
    };

    res.json({ 
      message: 'Logged in', 
      user: req.session.user
    });
  });

  apiRouter.post('/auth/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: 'Could not log out' });
      res.clearCookie('connect.sid');
      res.json({ message: 'Logged out' });
    });
  });

  apiRouter.get('/auth/me', authenticateToken, async (req, res) => {
    try {
      const user = await User.findById(req.user.id).populate('cart.product_id');
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json({ user: { id: user._id, ...user.toObject() } });
    } catch (error) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  apiRouter.get('/cart', authenticateToken, async (req, res) => {
    try {
      const user = await User.findById(req.user.id).populate('cart.product_id');
      res.json(user.cart);
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  apiRouter.post('/cart', authenticateToken, async (req, res) => {
    try {
      const { cart } = req.body; // Expecting array of { product_id, quantity }
      await User.findByIdAndUpdate(req.user.id, { cart });
      res.json({ message: 'Cart updated' });
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  apiRouter.patch('/auth/me', authenticateToken, async (req, res) => {
    const { name, phone, address } = req.body;
    await User.findByIdAndUpdate(req.user.id, { name, phone, address });
    res.json({ message: 'User updated' });
  });

  apiRouter.post('/auth/change-password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    try {
      const user = await User.findById(req.user.id);
      if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
        return res.status(401).json({ error: 'Invalid current password' });
      }
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.password = hashedPassword;
      await user.save();
      res.json({ message: 'Password updated successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Product Management
  apiRouter.get('/products', async (req, res) => {
    const products = await Product.find();
    res.json(products.map(p => ({ id: p._id, ...p.toObject() })));
  });

  apiRouter.get('/products/published', async (req, res) => {
    const products = await Product.find({ published: true });
    res.json(products.map(p => ({ id: p._id, ...p.toObject() })));
  });

  apiRouter.post('/products', authenticateToken, isAdmin, async (req, res) => {
    const { thumbnail, title, original_price, offer_price, items, type, zip_url, rating, category } = req.body;
    const discount_percentage = original_price > 0 ? ((original_price - offer_price) / original_price) * 100 : 0;
    const product = await Product.create({ 
      thumbnail, title, original_price, offer_price, discount_percentage, items, type, zip_url, rating, category 
    });
    res.json({ id: product._id });
  });

  apiRouter.put('/products/:id', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { thumbnail, title, original_price, offer_price, items, type, zip_url, rating, category } = req.body;
    const discount_percentage = original_price > 0 ? ((original_price - offer_price) / original_price) * 100 : 0;
    await Product.findByIdAndUpdate(id, { 
      thumbnail, title, original_price, offer_price, discount_percentage, items, type, zip_url, rating, category 
    });
    res.json({ message: 'Product updated' });
  });

  apiRouter.patch('/products/:id/publish', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { published } = req.body;
    await Product.findByIdAndUpdate(id, { published: !!published });
    res.json({ message: published ? 'Product published' : 'Product unpublished' });
  });

  apiRouter.delete('/products/:id', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    await Product.findByIdAndDelete(id);
    res.json({ message: 'Product deleted' });
  });

  // Orders & Payments
  apiRouter.post('/orders', authenticateToken, async (req, res) => {
    const { full_name, email, phone, address, total_price, items } = req.body;
    const order = await Order.create({
      user_id: req.user.id,
      full_name,
      email,
      phone,
      address,
      total_price
    });

    for (const item of items) {
      await OrderItem.create({
        order_id: order._id,
        product_id: item.id,
        price: item.offer_price
      });
    }

    res.json({ orderId: order._id });
  });

  apiRouter.patch('/orders/:id/payment', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { transaction_id, status } = req.body;
    await Order.findByIdAndUpdate(id, { transaction_id, status });
    res.json({ message: 'Payment updated' });
  });

  apiRouter.get('/payment/qr', async (req, res) => {
    const { amount, name, orderId } = req.query;
    console.log(`[QR Gen] Request - Raw Amount: ${amount}, Name: ${name}, OrderId: ${orderId}`);
    
    const amountStr = typeof amount === 'string' ? amount : '';
    const nameStr = typeof name === 'string' ? name : 'Customer';
    const orderIdStr = typeof orderId === 'string' ? orderId : '';

    if (!amountStr || isNaN(parseFloat(amountStr))) {
      console.error('[QR Gen] Invalid amount received:', amount);
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const numericAmount = parseFloat(amountStr);
    const formattedAmount = numericAmount.toFixed(2);
    console.log(`[QR Gen] Numeric Amount: ${numericAmount}, Formatted: ${formattedAmount}`);

    const vpa = process.env.UPI_VPA || 'kumarprashant514-3@okaxis';
    const rapidApiKey = process.env.RAPIDAPI_KEY || '38b1b4b8c6msh396eb5620a023a9p16ba80jsn82125e96dd8e';
    
    if (!rapidApiKey) {
      console.error('[QR Gen] RAPIDAPI_KEY not configured');
      return res.status(500).json({ error: 'RAPIDAPI_KEY not configured' });
    }

    try {
      console.log(`[QR Gen] Calling RapidAPI with VPA: ${vpa}, Name: ${nameStr}, Amount: ${formattedAmount}`);
      const response = await axios.get('https://upi-qr-code-generator-with-amount-and-name3.p.rapidapi.com/', {
        params: {
          vpa,
          pa: vpa,
          name: nameStr,
          pn: nameStr,
          amount: formattedAmount,
          am: formattedAmount,
          tr: orderIdStr || `TXN${Date.now()}`,
          tn: `Payment for Order #${orderIdStr || 'New'}`,
          type: 'data'
        },
        headers: {
          'x-rapidapi-host': 'upi-qr-code-generator-with-amount-and-name3.p.rapidapi.com',
          'x-rapidapi-key': rapidApiKey
        }
      });
      
      if (typeof response.data === 'string') {
        return res.json({ qr_code: response.data });
      }
      
      res.json(response.data);
    } catch (error) {
      console.error('QR Generation Error:', error.message);
      if (error.response) {
        return res.status(error.response.status).json({ error: 'API Error', details: error.response.data });
      }
      res.status(500).json({ error: 'Failed to generate QR code' });
    }
  });

  apiRouter.get('/orders/:id/check-payment', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const order = await Order.findOne({ _id: id, user_id: req.user.id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    res.json({ status: order.status, transaction_id: order.transaction_id });
  });

  apiRouter.post('/orders/:id/simulate-success', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const mockTxId = 'TXN' + Math.random().toString(36).substring(2, 10).toUpperCase();
    await Order.findByIdAndUpdate(id, { status: 'success', transaction_id: mockTxId });
    res.json({ status: 'success', transaction_id: mockTxId });
  });

  // API Key Management
  apiRouter.get('/keys', authenticateToken, async (req, res) => {
    try {
      const keys = await ApiKey.find({ user_id: req.user.id });
      res.json(keys.map(k => {
        const obj = k.toObject();
        return {
          ...obj,
          id: k._id.toString()
        };
      }));
    } catch (error) {
      console.error('[API Keys] Fetch Error:', error);
      res.status(500).json({ error: 'Failed to fetch keys' });
    }
  });

  apiRouter.post('/keys/generate', authenticateToken, async (req, res) => {
    console.log(`[API Keys] Generating key for user: ${req.user.id}`);
    try {
      const { name, baseKey, deactivateOthers } = req.body;
      console.log(`[API Keys] Params: name=${name}, baseKey=${baseKey}, deactivateOthers=${deactivateOthers}`);
      
      if (deactivateOthers) {
        const updateResult = await ApiKey.updateMany({ user_id: req.user.id, revoked: false }, { revoked: true });
        console.log(`[API Keys] Deactivated ${updateResult.modifiedCount} keys`);
      }

      const key = generateEncryptedKey(baseKey || ak);
      const newKey = await ApiKey.create({ user_id: req.user.id, key, name: name || 'Default Key' });
      console.log(`[API Keys] Created key: ${newKey._id}`);
      res.json({ key, id: newKey._id.toString() });
    } catch (error) {
      console.error('[API Keys] Generate Error:', error);
      res.status(500).json({ error: 'Failed to generate key', details: error.message });
    }
  });

  apiRouter.post('/keys/toggle', authenticateToken, async (req, res) => {
    const { keyId } = req.body;
    if (!keyId || !mongoose.Types.ObjectId.isValid(keyId)) {
      return res.status(400).json({ error: 'Invalid key ID' });
    }
    try {
      const key = await ApiKey.findOne({ _id: keyId, user_id: req.user.id });
      if (!key) return res.status(404).json({ error: 'Key not found' });
      
      key.revoked = !key.revoked;
      await key.save();
      res.json({ message: `Key ${key.revoked ? 'deactivated' : 'activated'}`, revoked: key.revoked });
    } catch (error) {
      console.error('[API Keys] Toggle Error:', error);
      res.status(500).json({ error: 'Failed to toggle key' });
    }
  });

  apiRouter.delete('/keys/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid key ID' });
    }
    try {
      const key = await ApiKey.findOneAndDelete({ _id: id, user_id: req.user.id });
      if (!key) return res.status(404).json({ error: 'Key not found' });
      res.json({ message: 'Key deleted successfully' });
    } catch (error) {
      console.error('[API Keys] Delete Error:', error);
      res.status(500).json({ error: 'Failed to delete key' });
    }
  });

  // Endpoint Cloning
  apiRouter.post('/endpoints/clone', authenticateToken, isAdmin, async (req, res) => {
    console.log(`[Endpoints] Cloning for user: ${req.user.id}`);
    let { originalUrl } = req.body;
    if (!originalUrl) return res.status(400).json({ error: 'Original URL is required' });
    
    originalUrl = originalUrl.trim();
    if (!originalUrl.startsWith('http://') && !originalUrl.startsWith('https://')) {
      originalUrl = 'https://' + originalUrl;
    }
    
    let clonedPath;
    try {
      const urlObj = new URL(originalUrl);
      clonedPath = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
      if (!clonedPath) clonedPath = uuidv4().split('-')[0];
    } catch (e) {
      clonedPath = uuidv4().split('-')[0];
    }
    
    try {
      console.log(`[Endpoints] Creating endpoint with path: ${clonedPath}`);
      await ClonedEndpoint.create({ user_id: req.user.id, original_url: originalUrl, cloned_path: clonedPath });
    } catch (err) {
      console.warn(`[Endpoints] Path conflict or error, retrying with suffix: ${err.message}`);
      clonedPath = `${clonedPath}-${uuidv4().split('-')[0]}`;
      await ClonedEndpoint.create({ user_id: req.user.id, original_url: originalUrl, cloned_path: clonedPath });
    }
    
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = process.env.APP_URL || `${protocol}://${host}`;
    const finalClonedUrl = `${baseUrl}/pixnora/${clonedPath}`;
    console.log(`[Endpoints] Cloned URL generated: ${finalClonedUrl}`);
    res.json({ clonedUrl: finalClonedUrl });
  });

  apiRouter.get('/endpoints', authenticateToken, isAdmin, async (req, res) => {
    const endpoints = await ClonedEndpoint.find({ user_id: req.user.id });
    res.json(endpoints.map(e => ({ id: e._id, ...e.toObject() })));
  });

  apiRouter.delete('/endpoints/:id', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    await ClonedEndpoint.findOneAndDelete({ _id: id, user_id: req.user.id });
    res.json({ message: 'Endpoint deleted' });
  });

  // API Tester / cURL Runner
  apiRouter.post('/test/curl', authenticateToken, isAdmin, async (req, res) => {
    let { method, url, headers, body } = req.body;
    
    // Resolve model_preset if present
    if (body && body.model_preset) {
      try {
        const preset = await ModelPreset.findOne({ user_id: req.user.id, name: body.model_preset });
        if (preset) {
          const promptValue = preset.data.get(body.model_preset);
          if (promptValue) {
            body.prompt = promptValue;
          }
        }
      } catch (err) {
        console.error('Preset resolution error:', err);
      }
    }

    try {
      const response = await axios({
        method,
        url,
        headers,
        data: body
      });
      res.status(response.status).json(response.data);
    } catch (error) {
      res.status(error.response?.status || 500).json(error.response?.data || { error: 'Request failed' });
    }
  });

  // Model Presets
  apiRouter.get('/presets', authenticateToken, isAdmin, async (req, res) => {
    const presets = await ModelPreset.find({ user_id: req.user.id });
    res.json(presets.map(p => ({ id: p._id, ...p.toObject() })));
  });

  apiRouter.post('/presets', authenticateToken, isAdmin, async (req, res) => {
    const { name, data } = req.body;
    const preset = await ModelPreset.create({ user_id: req.user.id, name, data });
    res.json({ id: preset._id });
  });

  apiRouter.put('/presets/:id', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, data } = req.body;
    await ModelPreset.findOneAndUpdate({ _id: id, user_id: req.user.id }, { name, data });
    res.json({ message: 'Preset updated' });
  });

  apiRouter.delete('/presets/:id', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    await ModelPreset.findOneAndDelete({ _id: id, user_id: req.user.id });
    res.json({ message: 'Preset deleted' });
  });

  app.use('/api', apiRouter);

  // Proxy / Cloned Endpoint Handler
  app.all('/pixnora/*', async (req, res) => {
    const clonedPath = req.params[0];
    const proxyKey = req.headers['apikey'];

    if (!proxyKey) return res.status(401).json({ error: 'API Key required (apikey)' });

    const validKey = await ApiKey.findOne({ key: proxyKey, revoked: false });
    if (!validKey) return res.status(403).json({ error: 'Invalid or revoked Proxy API Key' });

    const endpoint = await ClonedEndpoint.findOne({ cloned_path: clonedPath });
    if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

    let body = req.body;
    // Resolve model_preset if present in body
    if (body && body.model_preset) {
      try {
        const preset = await ModelPreset.findOne({ user_id: validKey.user_id, name: body.model_preset });
        if (preset) {
          const promptValue = preset.data.get(body.model_preset);
          if (promptValue) {
            body.prompt = promptValue;
          }
        }
      } catch (err) {
        console.error('Proxy preset resolution error:', err);
      }
    }

    try {
      const forwardedHeaders = { ...req.headers };
      delete forwardedHeaders['host'];
      delete forwardedHeaders['connection'];
      delete forwardedHeaders['content-length'];
      delete forwardedHeaders['apikey'];

      if (!forwardedHeaders['apikey']) {
        forwardedHeaders['apikey'] = '0000000000';
      }

      const response = await axios({
        method: req.method,
        url: endpoint.original_url,
        data: (req.method !== 'GET' && Object.keys(body).length > 0) ? body : undefined,
        headers: forwardedHeaders,
        timeout: 30000,
        validateStatus: () => true
      });
      res.status(response.status).json(response.data);
    } catch (error) {
      res.status(500).json({ error: 'Proxy request failed', message: error.message });
    }
  });

  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
