#!/bin/sh
set -eu
subnet=172.29.240.0/28
chain=STUDIO2-EGRESS
# Every hook matches only the dedicated deployment subnet; existing applications keep their rules.
if ! iptables -nL "$chain" >/dev/null 2>&1; then
  iptables -N "$chain"
  iptables -A "$chain" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  for destination in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 240.0.0.0/4; do
    iptables -A "$chain" -d "$destination" -j REJECT
  done
  iptables -A "$chain" -p tcp -m multiport --dports 80,443 -j RETURN
  iptables -A "$chain" -j REJECT
fi
iptables -C DOCKER-USER -s "$subnet" -j "$chain" 2>/dev/null || iptables -I DOCKER-USER 1 -s "$subnet" -j "$chain"
iptables -C INPUT -s "$subnet" -m conntrack --ctstate NEW -j REJECT 2>/dev/null || iptables -I INPUT 1 -s "$subnet" -m conntrack --ctstate NEW -j REJECT

subnet=172.29.240.16/28
chain=STUDIO2-POSTIZ
if ! iptables -nL "$chain" >/dev/null 2>&1; then
  iptables -N "$chain"
  iptables -A "$chain" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  for destination in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 240.0.0.0/4; do
    iptables -A "$chain" -d "$destination" -j REJECT
  done
  # Postiz's existing managed PostgreSQL database is external and requires TLS on 5432.
  iptables -A "$chain" -p tcp -m multiport --dports 80,443,5432 -j RETURN
  iptables -A "$chain" -j REJECT
fi
iptables -C DOCKER-USER -s "$subnet" -j "$chain" 2>/dev/null || iptables -I DOCKER-USER 1 -s "$subnet" -j "$chain"
iptables -C INPUT -s "$subnet" -m conntrack --ctstate NEW -j REJECT 2>/dev/null || iptables -I INPUT 1 -s "$subnet" -m conntrack --ctstate NEW -j REJECT

# Insert after both reject rules so this exception precedes them on first installation, too.
for subnet in 172.29.240.0/28 172.29.240.16/28; do
  iptables -C INPUT -s "$subnet" -d 31.97.186.120 -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -s "$subnet" -d 31.97.186.120 -p tcp --dport 443 -j ACCEPT
done
