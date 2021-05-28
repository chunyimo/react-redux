import { wrapMapToPropsConstant, wrapMapToPropsFunc } from './wrapMapToProps'
// 当mapStateToProps 是函数的时候
export function whenMapStateToPropsIsFunction(mapStateToProps) {
  return typeof mapStateToProps === 'function'
    ? wrapMapToPropsFunc(mapStateToProps, 'mapStateToProps')
    : undefined
}
// 当mapStateToProps为空的时候
export function whenMapStateToPropsIsMissing(mapStateToProps) {
  return !mapStateToProps ? wrapMapToPropsConstant(() => ({})) : undefined
}

export default [whenMapStateToPropsIsFunction, whenMapStateToPropsIsMissing]
