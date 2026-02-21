import axiosInstance from './axiosInterceptor'
import { AxiosResponse, isAxiosError } from 'axios'

export const getRequest = async (
  route: string,
  callback?: (res: AxiosResponse) => void
) => {
  try {
    const res = await axiosInstance.get(route)
    if (callback) callback(res)
    return res
  } catch (err: unknown) {
    if (isAxiosError(err)) {
      if (callback && err.response) callback(err.response)
      return err.response
    }
    return undefined
  }
}

export const postRequest = async (
  route: string,
  data: unknown,
  callback?: (res: AxiosResponse) => void
) => {
  try {
    const res = await axiosInstance.post(route, data)
    if (callback) callback(res)
    return res
  } catch (err: unknown) {
    if (isAxiosError(err)) {
      if (callback && err.response) callback(err.response)
      return err.response
    }
    return undefined
  }
}

export const patchRequest = async (
  route: string,
  data: unknown,
  callback?: (res: AxiosResponse) => void
) => {
  try {
    const res = await axiosInstance.patch(route, data)
    if (callback) callback(res)
    return res
  } catch (err: unknown) {
    if (isAxiosError(err)) {
      if (callback && err.response) callback(err.response)
      return err.response
    }
    return undefined
  }
}

export const deleteRequest = async (
  route: string,
  callback?: (res: AxiosResponse) => void
) => {
  try {
    const res = await axiosInstance.delete(route)
    if (callback) callback(res)
    return res
  } catch (err: unknown) {
    if (isAxiosError(err)) {
      if (callback && err.response) callback(err.response)
      return err.response
    }
    return undefined
  }
}
