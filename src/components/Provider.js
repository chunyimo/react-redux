/* eslint-disable valid-jsdoc */
/* eslint-disable prettier/prettier */
import React, { useMemo } from 'react'
import PropTypes from 'prop-types'
import { ReactReduxContext } from './Context'
import Subscription from '../utils/Subscription'
import { useIsomorphicLayoutEffect } from '../utils/useIsomorphicLayoutEffect'
/**
 * 这里的逻辑基本只会执行一次，一个app里面有一个store, 而这个store基本不会改变。
 * @param {*} param0 
 * @returns 
 */
function Provider({ store, context, children }) {
  // 利用useMemo,根据store变化创建出一个contextValue，包含一个根元素订阅器和当前store。
  const contextValue = useMemo(() => {
    // 创建一个根Subscription 订阅器
    const subscription = new Subscription(store)
    
    /* subscription 的 notifyNestedSubs 方法 ，赋值给  onStateChange方法 */
    subscription.onStateChange = subscription.notifyNestedSubs
    return {
      store,
      subscription,
    }
  }, [store])

  /*  获取更新之前的state值 ，函数组件里面的上下文要优先于组件更新渲染  */
  const previousState = useMemo(() => store.getState(), [store])

  // browser 端是useLayoutEffect；server端是useEffect
  useIsomorphicLayoutEffect(() => {
    const { subscription } = contextValue

    /* 触发trySubscribe方法执行，创建listens */
    subscription.trySubscribe()

    // 如果一个app中只有一个store，而store不会有人去改变它，这里永远为false，不会执行。
    if (previousState !== store.getState()) {
      /* 组件更新渲染之后，如果此时state发生改变，那么立即触发 subscription.notifyNestedSubs 方法  */
      subscription.notifyNestedSubs() // 更新组件
    }

    return () => {
      subscription.tryUnsubscribe() // 卸载更新
      subscription.onStateChange = null
    }
  }, [contextValue, previousState])

  const Context = context || ReactReduxContext

  return <Context.Provider value={contextValue}>{children}</Context.Provider>
}

if (process.env.NODE_ENV !== 'production') {
  Provider.propTypes = {
    store: PropTypes.shape({
      subscribe: PropTypes.func.isRequired,
      dispatch: PropTypes.func.isRequired,
      getState: PropTypes.func.isRequired,
    }),
    context: PropTypes.object,
    children: PropTypes.any,
  }
}

export default Provider
