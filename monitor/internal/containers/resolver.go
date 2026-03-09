package containers

import (
	"context"
	"log"
	"sync"

	containertypes "github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/events"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
)

// ContainerInfo holds information about a Docker container
type ContainerInfo struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Image string `json:"image"`
	IP    string `json:"ip"`
}

// Resolver maps container IPs to container information
type Resolver struct {
	cli        *client.Client
	ipMap      map[string]*ContainerInfo
	containers map[string]*ContainerInfo // by name
	mu         sync.RWMutex
}

// NewResolver creates a new container resolver
func NewResolver() (*Resolver, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}
	return &Resolver{
		cli:        cli,
		ipMap:      make(map[string]*ContainerInfo),
		containers: make(map[string]*ContainerInfo),
	}, nil
}

// Start begins watching for container changes
func (r *Resolver) Start(ctx context.Context) error {
	if err := r.refresh(ctx); err != nil {
		return err
	}
	go r.watch(ctx)
	return nil
}

// Resolve returns the container name for an IP
func (r *Resolver) Resolve(ip string) (string, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if info, ok := r.ipMap[ip]; ok {
		return info.Name, true
	}
	return "", false
}

// IsContainerIP checks if an IP belongs to a container
func (r *Resolver) IsContainerIP(ip string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.ipMap[ip]
	return ok
}

// GetContainers returns all tracked containers
func (r *Resolver) GetContainers() []*ContainerInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]*ContainerInfo, 0, len(r.containers))
	for _, c := range r.containers {
		cp := *c
		result = append(result, &cp)
	}
	return result
}

func (r *Resolver) refresh(ctx context.Context) error {
	networks, err := r.cli.NetworkList(ctx, network.ListOptions{})
	if err != nil {
		return err
	}

	newIPMap := make(map[string]*ContainerInfo)
	newContainers := make(map[string]*ContainerInfo)

	for _, net := range networks {
		if net.Driver != "bridge" {
			continue
		}
		netDetail, err := r.cli.NetworkInspect(ctx, net.ID, network.InspectOptions{})
		if err != nil {
			log.Printf("network inspect %s: %v", net.Name, err)
			continue
		}
		for _, endpoint := range netDetail.Containers {
			if endpoint.IPv4Address == "" {
				continue
			}
			ip := stripCIDR(endpoint.IPv4Address)
			info := &ContainerInfo{
				ID:   endpoint.EndpointID,
				Name: endpoint.Name,
				IP:   ip,
			}
			newIPMap[ip] = info
			newContainers[endpoint.Name] = info
		}
	}

	containerList, err := r.cli.ContainerList(ctx, containertypes.ListOptions{})
	if err == nil {
		for _, c := range containerList {
			name := ""
			if len(c.Names) > 0 {
				name = c.Names[0]
				if len(name) > 0 && name[0] == '/' {
					name = name[1:]
				}
			}
			if info, ok := newContainers[name]; ok {
				info.Image = c.Image
			}
		}
	}

	r.mu.Lock()
	r.ipMap = newIPMap
	r.containers = newContainers
	r.mu.Unlock()

	log.Printf("containers: refreshed, tracking %d containers", len(newIPMap))
	return nil
}

func (r *Resolver) watch(ctx context.Context) {
	eventsCh, errCh := r.cli.Events(ctx, events.ListOptions{})
	for {
		select {
		case <-ctx.Done():
			return
		case err := <-errCh:
			if ctx.Err() != nil {
				return
			}
			log.Printf("docker events error: %v", err)
			return
		case event := <-eventsCh:
			if event.Type == events.ContainerEventType || event.Type == events.NetworkEventType {
				if err := r.refresh(ctx); err != nil {
					log.Printf("container refresh error: %v", err)
				}
			}
		}
	}
}

// Close closes the Docker client
func (r *Resolver) Close() {
	r.cli.Close()
}

func stripCIDR(addr string) string {
	for i, ch := range addr {
		if ch == '/' {
			return addr[:i]
		}
	}
	return addr
}
