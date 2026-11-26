// Package middleware holds what every route group can share.
package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// RateLimit refuses a client that asks more than `perMinute` times in a minute.
//
// It guards the routes that need no account — pairing and a link request — so a
// stranger cannot hammer the Hub or flood one Controller with requests it will
// throw away. It is per process: one Hub's own memory, cleared as clients fall
// silent, and it is a rough limit rather than a quota.
func RateLimit(perMinute int) gin.HandlerFunc {
	type bucket struct {
		count int
		reset time.Time
	}
	var mu sync.Mutex
	buckets := map[string]*bucket{}
	window := time.Minute
	now := time.Now

	return func(c *gin.Context) {
		key := c.ClientIP()
		mu.Lock()
		b, seen := buckets[key]
		if !seen || now().After(b.reset) {
			b = &bucket{reset: now().Add(window)}
			buckets[key] = b
		}
		b.count++
		over := b.count > perMinute
		// Drop the buckets that have run out, so a Hub up for weeks does not grow one per address.
		if len(buckets) > 10_000 {
			for address, other := range buckets {
				if now().After(other.reset) {
					delete(buckets, address)
				}
			}
		}
		mu.Unlock()

		if over {
			c.Header("Retry-After", "60")
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "too_many_requests"})
			return
		}
		c.Next()
	}
}
