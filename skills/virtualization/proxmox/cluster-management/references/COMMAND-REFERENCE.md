# Full `pc` command reference by domain

SKILL.md §3 covers the two domains needed on almost every task (inventory and VM lifecycle). Read this file for everything else. All examples use `--context srv1`; swap for the target server. Replace `<vmid>` / `<node>` with real values.

## Contents

- [Create, clone, resize, migrate, template](#create-clone-resize-migrate-template)
- [Snapshots](#snapshots)
- [Guest agent](#guest-agent-in-guest-visibility--requires-agent-installed)
- [Containers (LXC)](#containers-lxc--same-grammar-as-vms)
- [Nodes](#nodes)
- [Storage & backups](#storage--backups)
- [Firewall](#firewall-cluster--node--guest-scope)
- [Networking (SDN)](#networking-sdn)
- [High Availability](#high-availability)
- [Ceph](#ceph)
- [Access control](#access-control-users-tokens-roles-acls)
- [Tasks, pools, tags, PBS](#tasks-pools-tags-pbs)

## Create, clone, resize, migrate, template

```sh
pc --context srv1 vm create --node srv1-pve --name web-01 --cores 4 --memory 4096
pc --context srv1 vm clone 9001 200 --name web-02 --full --storage local-lvm --wait
pc --context srv1 vm config 200 --set cores=8 --set memory=8192   # modify config
pc --context srv1 vm resize 101 --disk scsi0 --size +10G
pc --context srv1 vm migrate 101 --target-node srv2-pve --online
pc --context srv1 vm template 101              # convert VM → template
```

## Snapshots

```sh
pc --context srv1 vm snapshot list 101
pc --context srv1 vm snapshot create 101 pre-upgrade
pc --context srv1 vm snapshot rollback 101 pre-upgrade
pc --context srv1 vm snapshot delete 101 pre-upgrade
# cluster-wide:
pc --context srv1 snapshot list
pc --context srv1 snapshot prune --older-than 30d
```

## Guest agent (in-guest visibility — requires agent installed)

```sh
pc --context srv1 vm agent ping 101            # is the agent alive?
pc --context srv1 vm agent osinfo 101          # OS distro/version/kernel
pc --context srv1 vm agent network 101         # guest NIC IPs
pc --context srv1 vm agent exec 101 -- /usr/bin/uptime
pc --context srv1 vm agent fstrim 101
```

## Containers (LXC) — same grammar as VMs

```sh
pc --context srv1 ct list
pc --context srv1 ct show 201
pc --context srv1 ct start 201 ; pc --context srv1 ct stop 201 --yes
pc --context srv1 ct clone 201 202 --name sidecar
pc --context srv1 ct config 201 --set cores=2
pc --context srv1 ct snapshot create 201 pre-upgrade
```

## Nodes

```sh
pc --context srv1 node show srv1-pve
pc --context srv1 node network                 # NICs
pc --context srv1 node service list            # pveproxy, pvedaemon, etc.
pc --context srv1 node service restart pveproxy
pc --context srv1 node apt updates             # pending package updates
pc --context srv1 node subscription            # subscription status
```

## Storage & backups

```sh
pc --context srv1 storage status --node srv1-pve
pc --context srv1 storage prune-backups local --keep-last 7
pc --context srv1 backup create --vmid 101 --storage local --mode snapshot
pc --context srv1 backup list --storage local
pc --context srv1 backup job list              # scheduled backup jobs
pc --context srv1 backup job create --set vmid=101 --set storage=local --set mode=snapshot
```

## Firewall (cluster / node / guest scope)

```sh
pc --context srv1 firewall rules                       # cluster scope
pc --context srv1 firewall rules --node srv1-pve        # node scope
pc --context srv1 firewall rules --vmid 101             # guest scope
pc --context srv1 firewall rule add --node srv1-pve -d type=in,proto=tcp,dport=443,action=ACCEPT,comment="HTTPS"
pc --context srv1 firewall rule delete --node srv1-pve <pos>
pc --context srv1 firewall ipset ; pc --context srv1 firewall aliases ; pc --context srv1 firewall options
```

## Networking (SDN)

```sh
pc --context srv1 sdn zone list ; pc --context srv1 sdn vnet list ; pc --context srv1 sdn subnet list
pc --context srv1 sdn zone create --set zone=myzone --set type=simple
pc --context srv1 sdn vnet create --set vnet=myvnet --set zone=myzone
pc --context srv1 sdn apply                      # reload pending SDN config
```

## High Availability

```sh
pc --context srv1 ha status
pc --context srv1 ha resource list ; pc --context srv1 ha groups
pc --context srv1 ha resource add --vmid 101 --group mygroup
pc --context srv1 ha resource remove 101
```

## Ceph

```sh
pc --context srv1 ceph health ; pc --context srv1 ceph status
pc --context srv1 ceph osd-tree ; pc --context srv1 ceph pools
pc --context srv1 ceph pool create --node srv1-pve --set name=mydata --set pg_num=128
pc --context srv1 ceph osd out --node srv1-pve <osd-id>   # writes need --node
```

## Access control (users, tokens, roles, ACLs)

```sh
pc --context srv1 access user list ; pc --context srv1 access roles ; pc --context srv1 access permissions
pc --context srv1 access token list root@pam
pc --context srv1 access acl list
pc --context srv1 access acl set --path /vms/101 --roles PVEVMAdmin --ids svc@pve
```

## Tasks, pools, tags, PBS

```sh
pc --context srv1 task list ; pc --context srv1 task show <UPID> ; pc --context srv1 task log <UPID> ; pc --context srv1 task wait <UPID>
pc --context srv1 pool list ; pc --context srv1 pool create --pool dev
pc --context srv1 tag list ; pc --context srv1 tag add --vmid 101 --tag web
pc --context srv1 pbs remotes ; pc --context srv1 pbs status
```

For anything not listed above (any of the 675 PVE API endpoints), use `pc raw` or `pc api` — see SKILL.md §4.
