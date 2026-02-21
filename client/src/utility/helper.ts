import cookie from 'js-cookie'

export const getLocalStorage = (key: string) => {
  if (window) {
    return localStorage.getItem(key)
  }
}

export const setLocalStorage = (key: string, value: string) => {
  if (window) {
    localStorage.setItem(key, JSON.stringify(value))
  }
}

export const removeLocalStorage = (key: string) => {
  if (window) {
    localStorage.removeItem(key)
  }
}

export const setcookie = (key: string, value: string) => {
  if (window) {
    cookie.set(key, value, {
      expires: 1,
    })
  }
}

export const removecookie = (key: string) => {
  if (window) {
    cookie.remove(key, {
      expires: 1,
    })
  }
}

export const getcookie = (key: string) => {
  if (window) {
    return cookie.get(key)
  }
}

export const isAuth = () => {
  if (window) {
    return JSON.parse(localStorage.getItem('user') ?? '') ? true : false
  }
}

export const getLocalNotification = () => {
  if (window) {
    if (!localStorage.getItem('notification')) {
      return JSON.parse(localStorage.getItem('notification') ?? '')
    } else {
      return false
    }
  }
}

export const authenticate = (response: { data: string }) => {
  setLocalStorage('user', response.data)

  const expirationDate = new Date(
    new Date().getTime() + 60 * 60 * 24 * 10 * 1000
  )
  setLocalStorage('expirationDate', expirationDate.toDateString())
}
