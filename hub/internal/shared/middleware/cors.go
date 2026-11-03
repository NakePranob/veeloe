package middleware

import (
	"net/http"
	"slices"

	"github.com/gin-gonic/gin"
)

// CORS allows a fixed set of browser origins to call the API with
// credentials (cookies) — "*" can't be combined with Allow-Credentials per
// the fetch spec, so the origin is echoed back only when it's in
// allowedOrigins.
//
// openPaths answer any origin, without credentials: routes that a signature
// authenticates and that a Controller on any web host must reach.
func CORS(allowedOrigins []string, openPaths ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Vary", "Origin")
		if slices.Contains(openPaths, c.Request.URL.Path) {
			c.Header("Access-Control-Allow-Origin", "*")
			c.Header("Access-Control-Allow-Methods", "POST, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type")
			if c.Request.Method == http.MethodOptions {
				c.AbortWithStatus(http.StatusNoContent)
				return
			}
			c.Next()
			return
		}
		if origin := c.GetHeader("Origin"); slices.Contains(allowedOrigins, origin) {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Reauth-Token")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
