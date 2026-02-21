import axios from 'axios'

const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:8080'
const baseURL = serverUrl.endsWith('/api') ? serverUrl : `${serverUrl}/api`

const axiosInstance = axios.create({
  baseURL: baseURL,
  timeout: 15000,
  withCredentials: true, // Send httpOnly cookies with requests
})

axiosInstance.interceptors.response.use(
  (response) => {
    return response
  },
  (error) => {
    // Auth errors are handled by the AuthContext
    return Promise.reject(error)
  }
)

export default axiosInstance
