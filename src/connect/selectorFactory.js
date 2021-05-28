import verifySubselectors from './verifySubselectors'
// 直接将mapStateToProps，mapDispatchToProps，ownProps的执行结果合并作为返回值return出去
export function impureFinalPropsSelectorFactory(
  mapStateToProps,
  mapDispatchToProps,
  mergeProps,
  dispatch
) {
  return function impureFinalPropsSelector(state, ownProps) {
    return mergeProps(
      mapStateToProps(state, ownProps),
      mapDispatchToProps(dispatch, ownProps),
      ownProps
    )
  }
}

export function pureFinalPropsSelectorFactory(
  mapStateToProps,
  mapDispatchToProps,
  mergeProps,
  dispatch,
  { areStatesEqual, areOwnPropsEqual, areStatePropsEqual }
) {
  let hasRunAtLeastOnce = false
  let state
  let ownProps
  let stateProps
  let dispatchProps
  let mergedProps
  // 整个过程首次初始化的时候调用
  function handleFirstCall(firstState, firstOwnProps) {
    state = firstState
    ownProps = firstOwnProps
    stateProps = mapStateToProps(state, ownProps)
    dispatchProps = mapDispatchToProps(dispatch, ownProps)
    mergedProps = mergeProps(stateProps, dispatchProps, ownProps)
    hasRunAtLeastOnce = true
    return mergedProps
  }
  // props和state都有变化时调用 返回新的props
  function handleNewPropsAndNewState() {
    // 将mapStateToProps，mapDispatchToProps，ownProps的执行结果合并作为返回值return出去
    stateProps = mapStateToProps(state, ownProps)
    // 需要判断是否依赖props
    if (mapDispatchToProps.dependsOnOwnProps)
      dispatchProps = mapDispatchToProps(dispatch, ownProps)

    mergedProps = mergeProps(stateProps, dispatchProps, ownProps)
    return mergedProps
  }
  // 只有props变化时调用 返回新的props
  function handleNewProps() {
    // 将mapStateToProps，mapDispatchToProps，ownProps的执行结果合并作为返回值return出去
    if (mapStateToProps.dependsOnOwnProps)
      stateProps = mapStateToProps(state, ownProps)

    if (mapDispatchToProps.dependsOnOwnProps)
      dispatchProps = mapDispatchToProps(dispatch, ownProps)

    mergedProps = mergeProps(stateProps, dispatchProps, ownProps)
    return mergedProps
  }
  // 只有state变化时调用
  function handleNewState() {
    const nextStateProps = mapStateToProps(state, ownProps)
    const statePropsChanged = !areStatePropsEqual(nextStateProps, stateProps)
    stateProps = nextStateProps

    if (statePropsChanged)
      mergedProps = mergeProps(stateProps, dispatchProps, ownProps)

    return mergedProps
  }
  // 后续的过程调用
  function handleSubsequentCalls(nextState, nextOwnProps) {
    const propsChanged = !areOwnPropsEqual(nextOwnProps, ownProps)
    const stateChanged = !areStatesEqual(nextState, state)
    state = nextState
    ownProps = nextOwnProps

    if (propsChanged && stateChanged) return handleNewPropsAndNewState()
    if (propsChanged) return handleNewProps()
    if (stateChanged) return handleNewState()
    return mergedProps
  }

  return function pureFinalPropsSelector(nextState, nextOwnProps) {
    return hasRunAtLeastOnce
      ? handleSubsequentCalls(nextState, nextOwnProps)
      : handleFirstCall(nextState, nextOwnProps)
  }
}

// TODO: Add more comments

// If pure is true, the selector returned by selectorFactory will memoize its results,
// allowing connectAdvanced's shouldComponentUpdate to return false if final
// props have not changed. If false, the selector will always return a new
// object and shouldComponentUpdate will always return true.
// finalPropsSelectorFactory函数是在connectAdvaced函数内调用的selectorFactory函数
export default function finalPropsSelectorFactory(
  dispatch,
  { initMapStateToProps, initMapDispatchToProps, initMergeProps, ...options }
) {
  // 这里是wrapMapToProps.js中wrapMapToPropsFunc函数的柯里化调用，是改造
  // 之后的mapStateToProps, 在下边返回的函数内还会再调用一次
  const mapStateToProps = initMapStateToProps(dispatch, options)
  const mapDispatchToProps = initMapDispatchToProps(dispatch, options)
  const mergeProps = initMergeProps(dispatch, options)

  if (process.env.NODE_ENV !== 'production') {
    verifySubselectors(
      mapStateToProps,
      mapDispatchToProps,
      mergeProps,
      options.displayName
    )
  }

  const selectorFactory = options.pure
    ? pureFinalPropsSelectorFactory // 当props或state变化的时候，才去重新计算props
    : impureFinalPropsSelectorFactory // 直接重新计算props
  // 返回selectorFactory的调用
  return selectorFactory(
    mapStateToProps,
    mapDispatchToProps,
    mergeProps,
    dispatch,
    options
  )
}
