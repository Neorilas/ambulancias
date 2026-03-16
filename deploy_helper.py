import paramiko, sys, io, os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

host     = '91.107.235.70'
user     = 'root'
password = 'FiNDe991))!'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=password, timeout=30)
print(f'[OK] Conectado a {host}')

def run(cmd, timeout=120):
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    return out + err

# Ver estructura del frontend en el servidor
print('--- ls frontend ---')
print(run('ls ~/ambulancia/frontend/'))
print('--- ls frontend/src/pages/trabajos ---')
print(run('ls ~/ambulancia/frontend/src/pages/trabajos/ 2>/dev/null || echo NO_DIR'))
print('--- caddy config ---')
print(run('cat /etc/caddy/Caddyfile 2>/dev/null || cat ~/Caddyfile 2>/dev/null || find / -name Caddyfile 2>/dev/null | head -5'))
print('--- frontend dist ---')
print(run('ls ~/ambulancia/frontend/dist/ 2>/dev/null | head -10 || echo NO_DIST'))

client.close()
