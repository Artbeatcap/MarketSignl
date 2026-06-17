#!/bin/bash
# Fix chartsignl.com (naked domain) redirect to www.chartsignl.com

set -e

SERVER="root@167.88.43.61"
CONFIG_FILE="/etc/nginx/sites-available/chartsignl-web"

echo "🔧 Fixing naked domain redirect for chartsignl.com..."

# Create the updated Nginx config
cat > /tmp/chartsignl-web.conf << 'EOF'
# Redirect naked domain to www
server {
    listen 80;
    listen [::]:80;
    server_name chartsignl.com;
    return 301 https://www.chartsignl.com$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name chartsignl.com;
    
    ssl_certificate /etc/letsencrypt/live/app.chartsignl.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.chartsignl.com/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    
    return 301 https://www.chartsignl.com$request_uri;
}

# Main www site
server {
    listen 80;
    listen [::]:80;
    server_name www.chartsignl.com app.chartsignl.com;
    
    location ^~ /.well-known/acme-challenge/ {
        default_type "text/plain";
        allow all;
    }
    
    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name www.chartsignl.com app.chartsignl.com;

    ssl_certificate /etc/letsencrypt/live/app.chartsignl.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.chartsignl.com/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root /srv/chartsignl-web;
    index index.html;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/javascript application/javascript application/json;

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~ /\. {
        deny all;
    }
}
EOF

echo "📤 Uploading new config to VPS..."
scp /tmp/chartsignl-web.conf $SERVER:/tmp/chartsignl-web.conf

echo "🔄 Backing up old config and applying new one..."
ssh $SERVER << 'ENDSSH'
    # Backup old config
    cp /etc/nginx/sites-available/chartsignl-web /etc/nginx/sites-available/chartsignl-web.backup.$(date +%Y%m%d_%H%M%S)
    
    # Apply new config
    mv /tmp/chartsignl-web.conf /etc/nginx/sites-available/chartsignl-web
    
    # Test config
    echo "Testing Nginx configuration..."
    nginx -t
    
    # Reload Nginx
    echo "Reloading Nginx..."
    systemctl reload nginx
    
    echo "✅ Done! Nginx reloaded successfully."
ENDSSH

echo ""
echo "✅ Naked domain redirect configured!"
echo ""
echo "Test it:"
echo "  http://chartsignl.com -> https://www.chartsignl.com"
echo "  https://chartsignl.com -> https://www.chartsignl.com"
echo ""
echo "TLS: nginx uses Certbot lineage app.chartsignl.com (paths: /etc/letsencrypt/live/app.chartsignl.com/)."
echo "Renew or re-issue if expired / renew fails:"
echo "  ssh $SERVER"
echo "  certbot certonly --nginx --cert-name app.chartsignl.com -d chartsignl.com -d www.chartsignl.com -d app.chartsignl.com --force-renewal"

# Cleanup
rm /tmp/chartsignl-web.conf
