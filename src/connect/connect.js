/* eslint-disable valid-jsdoc */
/* eslint-disable prettier/prettier */
import connectAdvanced from '../components/connectAdvanced'
import shallowEqual from '../utils/shallowEqual'
import defaultMapDispatchToPropsFactories from './mapDispatchToProps'
import defaultMapStateToPropsFactories from './mapStateToProps'
import defaultMergePropsFactories from './mergeProps'
import defaultSelectorFactory from './selectorFactory'

/*
  connect is a facade over connectAdvanced. It turns its args into a compatible
  selectorFactory, which has the signature:

    (dispatch, options) => (nextState, nextOwnProps) => nextFinalProps
  
  connect passes its args to connectAdvanced as options, which will in turn pass them to
  selectorFactory each time a Connect component instance is instantiated or hot reloaded.

  selectorFactory returns a final props selector from its mapStateToProps,
  mapStateToPropsFactories, mapDispatchToProps, mapDispatchToPropsFactories, mergeProps,
  mergePropsFactories, and pure args.

  The resulting final props selector is called by the Connect component instance whenever
  it receives new props or store state.
 */

function match(arg, factories, name) {
  for (let i = factories.length - 1; i >= 0; i--) {
    const result = factories[i](arg)
    if (result) return result
  }

  return (dispatch, options) => {
    throw new Error(
      `Invalid value of type ${typeof arg} for ${name} argument when connecting component ${
        options.wrappedComponentName
      }.`
    )
  }
}

function strictEqual(a, b) {
  return a === b
}

// createConnect with default args builds the 'official' connect behavior. Calling it with
// different options opens up some testing and extensibility scenarios
/**
 * 
 * @param {*} param0 
 * @returns 
 */
export function createConnect({
  connectHOC = connectAdvanced,
  mapStateToPropsFactories = defaultMapStateToPropsFactories,
  mapDispatchToPropsFactories = defaultMapDispatchToPropsFactories,
  mergePropsFactories = defaultMergePropsFactories,
  selectorFactory = defaultSelectorFactory,
} = {}) {
  return function connect(
    mapStateToProps,
    mapDispatchToProps,
    mergeProps,
    {
      pure = true,
      areStatesEqual = strictEqual,
      areOwnPropsEqual = shallowEqual,
      areStatePropsEqual = shallowEqual,
      areMergedPropsEqual = shallowEqual,
      ...extraOptions
    } = {}
  ) {
    // 将我们传入的mapStateToProps， mapDispatchToProps， mergeProps都初始化一遍
    // 常规路线返回  wrapMapToPropsFunc(mapStateToProps, 'mapStateToProps')
    // mapToProps 指 mapStateToProps 或者 mapDispatchToProps
    // initMapStateToProps: (dispatch) => (stateOrDispatch, ownProps) => { return mapToProps(stateOrDispatch, ownProps)}
    const initMapStateToProps = match(
      mapStateToProps,
      mapStateToPropsFactories,
      'mapStateToProps'
    )
    const initMapDispatchToProps = match(
      mapDispatchToProps,
      mapDispatchToPropsFactories,
      'mapDispatchToProps'
    )
    const initMergeProps = match(mergeProps, mergePropsFactories, 'mergeProps')
    // connectHOC 即connectAdvanced
    /* 
      selectorFactory：(dispatch, {initMapStateToProps,initMapDispatchToProps, initMergeProps}) 
        => (nextState, nextOwnProps) => new mergerdProps
    */
    return connectHOC(selectorFactory, {
      // used in error messages
      methodName: 'connect',

      // used to compute Connect's displayName from the wrapped component's displayName.
      getDisplayName: (name) => `Connect(${name})`,

      // if mapStateToProps is falsy, the Connect component doesn't subscribe to store state changes
      shouldHandleStateChanges: Boolean(mapStateToProps),

      // passed through to selectorFactory
      initMapStateToProps,
      initMapDispatchToProps,
      initMergeProps,
      pure,
      areStatesEqual,
      areOwnPropsEqual,
      areStatePropsEqual,
      areMergedPropsEqual,

      // any extra options args can override defaults of connect or connectAdvanced
      ...extraOptions,
    })
  }
}

export default /*#__PURE__*/ createConnect()


/* demo

import React from 'react'
import { connect } from '../../react-redux-src'
import { increaseAction, decreaseAction } from '../../actions/counter'
import { Button } from 'antd'
class Child extends React.Component {
  render() {
    const { increaseAction, decreaseAction, num } = this.props
    return <div>
        {num}
        <Button onClick={() => increaseAction()}>增加</Button>
        <Button onClick={() => decreaseAction()}>减少</Button>
    </div>
  }
}
const mapStateToProps = (state, ownProps) => {
  const { counter } = state
  return {
    num: counter.num
  }
}

const mapDispatchToProps = (dispatch, ownProps) => {
  return {
    increaseAction: () => dispatch({
      type: INCREASE
    }),
    decreaseAction: () => dispatch({
      type: DECREASE
    })
  }
}
export default connect(mapStateToProps, mapDispatchToProps)(Child)

*/

/*
  在connet中先对传入的mapToProps 进行初始化，在把mapToProps的处理函数selectorFactory 和 初始化后的mapToProps给
  connectAdvanced，在其内部进行处理。
  connect(mapStateToProps, mapDispatchToProps) 
    => connectAdvanced(selectorFactory, {...initMapToProps})
  connectAdvanced: (selectorFactory, {...initMapToProps}) => (WrappedComponent) => {

  }

  connet: (mapStateToProps, mapDispatchToProps) =>  (WrappedComponent) => <Connect />


  Connect = <Context.Provider value={ContextValue}>
              {<WrappedComponent {...props} />}
  </Context.Provider>

  props 有来自从store map而来的最新值，也有直接传到WrappedComponent的属性

  connect 可以视为两层柯里化的函数，第二层（(WrappedComponent) => <Connect />），我们称为wrapWithConnect，
  在wrapWithConnect中有两个effect 钩子(server 端为useEffect、browser端为useLayoutEffect)。
  第一个effect钩子，没有设置依赖，每次都会执行，只要有来自store的新props就会通知执行listeners

  第二个effect钩子，基本上只会执行一次，其作用就是设置 subscription.onStateChange = checkForUpdates，注册一个更新回调
  如图所示：src\connect\call stack.png
*/