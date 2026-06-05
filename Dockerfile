# Use nginx unprivileged as the base image for serving static files
FROM nginxinc/nginx-unprivileged:alpine

# Temporarily switch to root to fix permissions for OpenShift (arbitrary UID, GID 0)
USER root

# Make directories writable by root group (GID 0) for OpenShift compatibility
RUN chgrp -R 0 /var/cache/nginx /var/log/nginx /etc/nginx/conf.d /usr/share/nginx/html && \
    chmod -R g=u /var/cache/nginx /var/log/nginx /etc/nginx/conf.d /usr/share/nginx/html && \
    touch /var/run/nginx.pid && chgrp 0 /var/run/nginx.pid && chmod g=u /var/run/nginx.pid

# Copy static files to nginx html directory
COPY index.html /usr/share/nginx/html/
COPY game.js /usr/share/nginx/html/
COPY style.css /usr/share/nginx/html/
COPY phaser.min.js /usr/share/nginx/html/

# Switch back to non-root user
USER 1001

# Expose port 8080 (unprivileged nginx listens on 8080 by default)
EXPOSE 8080

# Start nginx server
CMD ["nginx", "-g", "daemon off;"]
