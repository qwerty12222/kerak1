#!/bin/bash

echo "🚀 Professional Test Bot - Vercel Deploy Script"
echo "=================================================="

# Check if required files exist
if [ ! -f "package.json" ]; then
    echo "❌ package.json topilmadi!"
    exit 1
fi

if [ ! -f "vercel.json" ]; then
    echo "❌ vercel.json topilmadi!"
    exit 1
fi

if [ ! -f ".env" ]; then
    echo "⚠️  .env fayli topilmadi. .env.example ni nusxalang va to'ldiring."
    echo "cp .env.example .env"
    echo "Keyin .env faylini tahrirlang va qayta ishga tushiring."
    exit 1
fi

# Install dependencies
echo "📦 Dependencies o'rnatilmoqda..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Dependencies o'rnatishda xatolik!"
    exit 1
fi

# Deploy to Vercel
echo "🌐 Vercel'ga deploy qilinmoqda..."
vercel --prod

if [ $? -ne 0 ]; then
    echo "❌ Deploy jarayonida xatolik!"
    exit 1
fi

# Get deployment URL
echo "🔗 Deployment URL ni olish..."
DEPLOY_URL=$(vercel --prod --confirm)

if [ -z "$DEPLOY_URL" ]; then
    echo "⚠️  Deployment URL avtomatik olinmadi. Vercel dashboard ni tekshiring."
else
    echo "✅ Deploy muvaffaqiyatli!"
    echo "🌍 URL: $DEPLOY_URL"
    
    # Set webhook
    echo "🔗 Webhook o'rnatilmoqda..."
    curl -s "$DEPLOY_URL/api/set_webhook" > /dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ Webhook muvaffaqiyatli o'rnatildi!"
    else
        echo "⚠️  Webhook o'rnatishda muammo. Qo'lda o'rnating: $DEPLOY_URL/api/set_webhook"
    fi
    
    # Check bot health
    echo "🔍 Bot holatini tekshirish..."
    HEALTH_RESPONSE=$(curl -s "$DEPLOY_URL/api/health")
    
    if [[ $HEALTH_RESPONSE == *"healthy"* ]]; then
        echo "✅ Bot sog'lom va ishlayapti!"
    else
        echo "⚠️  Bot holatini tekshirib bo'lmadi: $DEPLOY_URL/api/health"
    fi
    
    echo ""
    echo "🎉 DEPLOY YAKUNLANDI!"
    echo "======================================"
    echo "🌍 Bot URL: $DEPLOY_URL"
    echo "🔗 Webhook: $DEPLOY_URL/api/webhook" 
    echo "🏥 Health: $DEPLOY_URL/api/health"
    echo "📊 Bot info: $DEPLOY_URL/api/bot_info"
    echo ""
    echo "🤖 Bot test qilish uchun Telegram'da ishga tushiring!"
fi
