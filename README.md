# 💧 مياه واحة عمان - Oman Oasis Water

منصة تجارة إلكترونية متكاملة لبيع مياه الشرب من سلطنة عمان.

## 🚀 المميزات

### صفحات العميل
- 🏠 الصفحة الرئيسية مع عرض المنتجات
- 📦 صفحة بيانات التوصيل
- 💳 صفحة الدفع
- 🔐 صفحة التحقق (OTP)

### لوحة تحكم الإدارة
- 📊 إحصائيات فورية (الزوار، الطلبات، الدول)
- 👥 متابعة الزوار بالوقت الفعلي (تحديث كل ثانية)
- 🔔 نظام إشعارات صوتية للأدمن
- 📦 إدارة المنتجات (CRUD)
- 🚫 نظام حظر المستخدمين
- 📱 إدارة الأجهزة المتصلة

## 🛠️ التقنيات المستخدمة

### Backend
- Node.js
- Express.js
- Socket.io (للتحديثات الفورية)
- PostgreSQL (Neon)
- bcryptjs (لتشفير كلمات المرور)
- geoip-lite (لتحديد الدول)

### Frontend
- HTML5
- CSS3
- Vanilla JavaScript
- Socket.io Client

## 📦 التثبيت

### 1. استنساخ المشروع
```bash
git clone https://github.com/alwtnyaldm-glitch/wateroman.git
cd wateroman
```

### 2. تثبيت الحزم
```bash
cd backend
npm install
```

### 3. إعداد قاعدة البيانات
قم بإنشاء ملف `.env` في مجلد backend:
```env
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
PORT=3000
ADMIN_DEFAULT_PASSWORD=admin123
```

### 4. تشغيل السيرفر
```bash
npm start
```

## 🔐 بيانات الدخول للوحة التحكم

- **اسم المستخدم:** `admin`
- **كلمة المرور:** `admin123`

## 📁 هيكل المشروع

```
wateroman/
├── backend/
│   ├── config/
│   │   └── database.js
│   ├── models/
│   │   └── schema.js
│   ├── routes/
│   │   ├── admin.js
│   │   ├── products.js
│   │   └── visitors.js
│   ├── server.js
│   ├── package.json
│   └── .env
├── frontend/
│   ├── admin/
│   │   ├── index.html
│   │   ├── admin.js
│   │   └── admin.css
│   ├── pages/
│   │   ├── delivery.html
│   │   ├── payment.html
│   │   └── verification.html
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   └── main.js
│   └── index.html
└── README.md
```

## 🌐 الروابط

- **الموقع:** http://localhost:3000
- **لوحة التحكم:** http://localhost:3000/admin
- **API:** http://localhost:3000/api

## 📊 قواعد البيانات

### جدول المنتجات (products)
| الحقل | النوع | الوصف |
|-------|------|-------|
| id | SERIAL | المعرف |
| name_ar | VARCHAR | الاسم بالعربية |
| name_en | VARCHAR | الاسم بالإنجليزية |
| description | TEXT | الوصف |
| price | DECIMAL | السعر |
| image_url | VARCHAR | رابط الصورة |
| category | VARCHAR | الفئة |
| stock | INTEGER | المخزون |

### جدول الزوار (visitors)
| الحقل | النوع | الوصف |
|-------|------|-------|
| session_id | VARCHAR | معرف الجلسة |
| ip_address | VARCHAR | عنوان IP |
| country | VARCHAR | الدولة |
| current_page | VARCHAR | الصفحة الحالية |
| is_online | BOOLEAN | حالة الاتصال |
| delivery_data | JSONB | بيانات التوصيل |
| payment_data | JSONB | بيانات الدفع |

## 🔔 الإشعارات الصوتية

- **👤 زائر جديد:** نغمة ترحيبية
- **📝 نموذج التوصيل:** نغمة قصيرة
- **💳 بيانات الدفع:** نغمة متوسطة
- **🔐 رمز التحقق:** نغمة طويلة

## 📝 الرخصة

MIT License
