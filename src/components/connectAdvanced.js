/* eslint-disable valid-jsdoc */
import hoistStatics from 'hoist-non-react-statics'
import React, { useContext, useMemo, useRef, useReducer } from 'react'
import { isValidElementType, isContextConsumer } from 'react-is'
import Subscription from '../utils/Subscription'
import { useIsomorphicLayoutEffect } from '../utils/useIsomorphicLayoutEffect'

import { ReactReduxContext } from './Context'

// Define some constant arrays just to avoid re-creating these
const EMPTY_ARRAY = []
const NO_SUBSCRIPTION_ARRAY = [null, null]

const stringifyComponent = (Comp) => {
  try {
    return JSON.stringify(Comp)
  } catch (err) {
    return String(Comp)
  }
}
// 内置的reducer
function storeStateUpdatesReducer(state, action) {
  const [, updateCount] = state
  return [action.payload, updateCount + 1]
}

function useIsomorphicLayoutEffectWithArgs(
  effectFunc,
  effectArgs,
  dependencies
) {
  useIsomorphicLayoutEffect(() => effectFunc(...effectArgs), dependencies)
}

function captureWrapperProps(
  lastWrapperProps,
  lastChildProps,
  renderIsScheduled,
  wrapperProps,
  actualChildProps,
  childPropsFromStoreUpdate,
  notifyNestedSubs
) {
  // We want to capture the wrapper props and child props we used for later comparisons
  lastWrapperProps.current = wrapperProps // 获取组件自己的props
  lastChildProps.current = actualChildProps // 获取到注入到组件的props
  renderIsScheduled.current = false // 表明已经过了渲染阶段

  // If the render was from a store update, clear out that reference and cascade the subscriber update
  // 如果来自store的props更新了，那么通知listeners去执行，
  // 也就是执行先前被订阅的this.handleChangeWrapper（Subscription类中），
  // handleChangeWrapper中调用的是onStateChange，
  // 也就是在下边赋值的负责更新页面的函数checkForUpdates
  if (childPropsFromStoreUpdate.current) {
    childPropsFromStoreUpdate.current = null
    notifyNestedSubs()
  }
}

function subscribeUpdates(
  shouldHandleStateChanges,
  store,
  subscription,
  childPropsSelector,
  lastWrapperProps,
  lastChildProps,
  renderIsScheduled,
  childPropsFromStoreUpdate,
  notifyNestedSubs,
  forceComponentUpdateDispatch
) {
  // If we're not subscribed to the store, nothing to do here
  // 如果没有订阅，直接return，
  // shouldHandleStateChanges默认为true，所以默认情况会继续执行
  if (!shouldHandleStateChanges) return

  // Capture values for checking if and when this component unmounts
  // 当组件卸载的时候，用闭包，声明两个变量标记是否被取消订阅和错误对象
  let didUnsubscribe = false
  let lastThrownError = null

  // We'll run this callback every time a store subscription update propagates to this component
  // 当store或者subscription变化的时候，回调会被重新执行，从而实现重新订阅
  const checkForUpdates = () => {
    if (didUnsubscribe) {
      // Don't run stale listeners.
      // Redux doesn't guarantee unsubscriptions happen until next dispatch.
      return
    }
    // 获取到最新的state
    const latestStoreState = store.getState()

    let newChildProps, error
    try {
      // Actually run the selector with the most recent store state and wrapper props
      // to determine what the child props should be
      // 使用selector获取到最新的props
      newChildProps = childPropsSelector(
        latestStoreState,
        lastWrapperProps.current
      )
    } catch (e) {
      error = e
      lastThrownError = e
    }

    if (!error) {
      lastThrownError = null
    }

    // If the child props haven't changed, nothing to do here - cascade the subscription update
    // 如果props没变化，只通知一下listeners更新
    if (newChildProps === lastChildProps.current) {
      if (!renderIsScheduled.current) {
        notifyNestedSubs()
      }
    } else {
      // Save references to the new child props.  Note that we track the "child props from store update"
      // as a ref instead of a useState/useReducer because we need a way to determine if that value has
      // been processed.  If this went into useState/useReducer, we couldn't clear out the value without
      // forcing another re-render, which we don't want.
      // 如果props有变化，将新的props缓存起来，
      // 并且将childPropsFromStoreUpdate.current设置为新的props，便于在第一个
      // captureWrapperProps 执行的时候能够识别出props确实是更新了
      lastChildProps.current = newChildProps
      childPropsFromStoreUpdate.current = newChildProps
      renderIsScheduled.current = true

      // If the child props _did_ change (or we caught an error), this wrapper component needs to re-render
      // 当dispatch 内置的action时候，ConnectFunction这个组件会更新，从而达到更新组件的目的
      forceComponentUpdateDispatch({
        type: 'STORE_UPDATED',
        payload: {
          error,
        },
      })
    }
  }

  // Actually subscribe to the nearest connected ancestor (or store)
  // onStateChange的角色也就是listener。在provider中，赋值为更新listeners。
  // 在ConnectFunction中赋值为checkForUpdates
  // 而checkForUpdates做的工作就是根据props的变化，相当于listener，更新ConnectFunction自身
  subscription.onStateChange = checkForUpdates
  subscription.trySubscribe()

  // Pull data from the store after first render in case the store has
  // changed since we began.
  // 第一次渲染后先执行一次，从store中同步数据
  checkForUpdates()
  // 返回一个取消订阅的函数，目的是在组件卸载时取消订阅
  const unsubscribeWrapper = () => {
    didUnsubscribe = true
    subscription.tryUnsubscribe()
    subscription.onStateChange = null

    if (lastThrownError) {
      // It's possible that we caught an error due to a bad mapState function, but the
      // parent re-rendered without this component and we're about to unmount.
      // This shouldn't happen as long as we do top-down subscriptions correctly, but
      // if we ever do those wrong, this throw will surface the error in our tests.
      // In that case, throw the error from here so it doesn't get lost.
      throw lastThrownError
    }
  }

  return unsubscribeWrapper
}

const initStateUpdates = () => [null, 0]
/**
 * react-redux 会更新被connect过的组件，而connect返回的connectAdvanced，而connectAdvanced
 * 会返回我们传入的组件，
 * 更新的本质时connectAdvanced内部依据store的变化更新自身，进而达到更新组件的目的。
 *
 */
export default function connectAdvanced(
  /*
    selectorFactory is a func that is responsible for returning the selector function used to
    compute new props from state, props, and dispatch. For example:

      export default connectAdvanced((dispatch, options) => (state, props) => ({
        thing: state.things[props.thingId],
        saveThing: fields => dispatch(actionCreators.saveThing(props.thingId, fields)),
      }))(YourComponent)

    Access to dispatch is provided to the factory so selectorFactories can bind actionCreators
    outside of their selector as an optimization. Options passed to connectAdvanced are passed to
    the selectorFactory, along with displayName and WrappedComponent, as the second argument.

    Note that selectorFactory is responsible for all caching/memoization of inbound and outbound
    props. Do not use connectAdvanced directly without memoizing results between calls to your
    selector, otherwise the Connect component will re-render on every state or props change.
  */
  /* 
    selectorFactory：(dispatch, {initMapStateToProps,initMapDispatchToProps, initMergeProps}) 
      => (nextState, nextOwnProps) => new mergerdProps
  */
  selectorFactory,
  // options object:
  {
    // the func used to compute this HOC's displayName from the wrapped component's displayName.
    // probably overridden by wrapper functions such as connect()
    getDisplayName = (name) => `ConnectAdvanced(${name})`,

    // shown in error messages
    // probably overridden by wrapper functions such as connect()
    methodName = 'connectAdvanced',

    // REMOVED: if defined, the name of the property passed to the wrapped element indicating the number of
    // calls to render. useful for watching in react devtools for unnecessary re-renders.
    renderCountProp = undefined,

    // determines whether this HOC subscribes to store changes
    shouldHandleStateChanges = true,

    // REMOVED: the key of props/context to get the store
    storeKey = 'store',

    // REMOVED: expose the wrapped component via refs
    withRef = false,

    // use React's forwardRef to expose a ref of the wrapped component
    forwardRef = false,

    // the context consumer to use
    context = ReactReduxContext,

    // additional options are passed through to the selectorFactory
    ...connectOptions
  } = {}
) {
  if (process.env.NODE_ENV !== 'production') {
    if (renderCountProp !== undefined) {
      throw new Error(
        `renderCountProp is removed. render counting is built into the latest React Dev Tools profiling extension`
      )
    }
    if (withRef) {
      throw new Error(
        'withRef is removed. To access the wrapped instance, use a ref on the connected component'
      )
    }

    const customStoreWarningMessage =
      'To use a custom Redux store for specific components, create a custom React context with ' +
      "React.createContext(), and pass the context object to React Redux's Provider and specific components" +
      ' like: <Provider context={MyContext}><ConnectedComponent context={MyContext} /></Provider>. ' +
      'You may also pass a {context : MyContext} option to connect'

    if (storeKey !== 'store') {
      throw new Error(
        'storeKey has been removed and does not do anything. ' +
          customStoreWarningMessage
      )
    }
  }

  const Context = context

  return function wrapWithConnect(WrappedComponent) {
    if (
      process.env.NODE_ENV !== 'production' &&
      !isValidElementType(WrappedComponent)
    ) {
      throw new Error(
        `You must pass a component to the function returned by ` +
          `${methodName}. Instead received ${stringifyComponent(
            WrappedComponent
          )}`
      )
    }

    const wrappedComponentName =
      WrappedComponent.displayName || WrappedComponent.name || 'Component'

    const displayName = getDisplayName(wrappedComponentName)
    // selectorFactoryOptions是包含了我们初始化的mapToProps的一系列参数，为构造selector 做准备
    const selectorFactoryOptions = {
      ...connectOptions,
      getDisplayName,
      methodName,
      renderCountProp,
      shouldHandleStateChanges,
      storeKey,
      displayName,
      wrappedComponentName,
      WrappedComponent,
    }
    // pure表示只有当state或者ownProps变动的时候，重新计算生成selector。
    const { pure } = connectOptions

    /* createChildSelector 的调用形式：createChildSelector(store)(state, ownProps)，
       createChildSelector返回了selectorFactory的调用，而selectorFactory实际上是其内部根据options.pure返回的
       impureFinalPropsSelectorFactory 或者是 pureFinalPropsSelectorFactory的调用，而这两个函数需要的参数是
           mapStateToProps,
           mapDispatchToProps,
           mergeProps,
           dispatch,
           options
       除了dispatch，其余参数都可从selectorFactoryOptions中获得。调用的返回值，就是selector。而selector需要的参数是
       (state, ownprops)。所以得出结论，createChildSelector(store)就是selector
    */
    function createChildSelector(store) {
      // 这里是selectorFactory.js中finalPropsSelectorFactory的调用
      // （本质上也就是上面我们初始化的mapToProps的调用），传入dispatch，和options
      // 最终拿到finalPropsSelector: (nextState, nextOwnProps) => new mergerdProps
      return selectorFactory(store.dispatch, selectorFactoryOptions)
    }

    // If we aren't running in "pure" mode, we don't want to memoize values.
    // To avoid conditionally calling hooks, we fall back to a tiny wrapper
    // that just executes the given callback immediately.
    // 根据是否是pure模式来决定是否需要对更新的方式做优化，pure在这里的意义类似于React的PureComponent
    const usePureOnlyMemo = pure ? useMemo : (callback) => callback()

    function ConnectFunction(props) {
      // props变化，获取最新的context,forwardedRef以及组件其他props
      const [propsContext, reactReduxForwardedRef, wrapperProps] =
        useMemo(() => {
          // Distinguish between actual "data" props that were passed to the wrapper component,
          // and values needed to control behavior (forwarded refs, alternate context instances).
          // To maintain the wrapperProps object reference, memoize this destructuring.
          const { reactReduxForwardedRef, ...wrapperProps } = props
          return [props.context, reactReduxForwardedRef, wrapperProps]
        }, [props])
      // propsContext或Context发生变化，决定使用哪个context，如果propsContext存在则优先使用
      const ContextToUse = useMemo(() => {
        // Users may optionally pass in a custom context instance to use instead of our ReactReduxContext.
        // Memoize the check that determines which context instance we should use.
        return propsContext &&
          propsContext.Consumer &&
          isContextConsumer(<propsContext.Consumer />)
          ? propsContext
          : Context
      }, [propsContext, Context])

      // Retrieve(拿到) the store and ancestor subscription via context, if available
      // 通过上层组件获取上下文中的value，包含store和subscription
      // 当上层组件最近的context变化的时候，返回该context的当前值，也就是{store, subscription}
      const contextValue = useContext(ContextToUse)

      // The store _must_ exist as either a prop or in context.
      // We'll check to see if it _looks_ like a Redux store first.
      // This allows us to pass through a `store` prop that is just a plain value.

      // !store必须存在于prop或者context中
      // 判断store是否是来自props中的store
      const didStoreComeFromProps =
        Boolean(props.store) &&
        Boolean(props.store.getState) &&
        Boolean(props.store.dispatch)
      // 判断store是否是来自context中的store
      const didStoreComeFromContext =
        Boolean(contextValue) && Boolean(contextValue.store)

      // 自己提供了一个context，但是又没有提供store属性，然后又没有在props里面传入store，那就找不到store了，报错
      if (
        process.env.NODE_ENV !== 'production' &&
        !didStoreComeFromProps &&
        !didStoreComeFromContext
      ) {
        throw new Error(
          `Could not find "store" in the context of ` +
            `"${displayName}". Either wrap the root component in a <Provider>, ` +
            `or pass a custom React context provider to <Provider> and the corresponding ` +
            `React context consumer to ${displayName} in connect options.`
        )
      }

      // Based on the previous check, one of these must be true
      // 取出store
      // ReactRedux 的 Context 的contextValue = {store, subscription}
      const store = didStoreComeFromProps ? props.store : contextValue.store

      // childPropsSelector: (nextState, nextOwnProps) => new mergerdProps
      const childPropsSelector = useMemo(() => {
        // The child props selector needs the store reference as an input.
        // Re-create this selector whenever the store changes.
        // 仅当store变化的时候，创建selector
        // 调用childPropsSelector => childPropsSelector(dispatch, options)
        return createChildSelector(store)
      }, [store])

      const [subscription, notifyNestedSubs] = useMemo(() => {
        if (!shouldHandleStateChanges) return NO_SUBSCRIPTION_ARRAY

        // This Subscription's source should match where store came from: props vs. context. A component
        // connected to the store via props shouldn't use subscription from context, or vice versa.
        // 如果store是从props中来的，就不再传入subscription实例，否则使用context中传入的subscription实例
        const subscription = new Subscription(
          store,
          didStoreComeFromProps ? null : contextValue.subscription
        )

        // `notifyNestedSubs` is duplicated to handle the case where the component is unmounted in
        // the middle of the notification loop, where `subscription` will then be null. This can
        // probably be avoided if Subscription's listeners logic is changed to not call listeners
        // that have been unsubscribed in the  middle of the notification loop.
        const notifyNestedSubs =
          subscription.notifyNestedSubs.bind(subscription)

        return [subscription, notifyNestedSubs]
      }, [store, didStoreComeFromProps, contextValue])

      // Determine what {store, subscription} value should be put into nested context, if necessary,
      // and memoize that value to avoid unnecessary context updates.
      // contextValue就是store，将store重新覆盖一遍，注入subscription，
      // 这样被connect的组件在context中可以拿到subscription
      const overriddenContextValue = useMemo(() => {
        if (didStoreComeFromProps) {
          // This component is directly subscribed to a store from props.
          // We don't want descendants reading from this store - pass down whatever
          // the existing context value is from the nearest connected ancestor.
          // 如果组件是直接订阅到来自props中的store，就直接使用来自props中的context
          return contextValue
        }

        // Otherwise, put this component's subscription instance into context, so that
        // connected descendants won't update until after this component is done
        // 如果store是从context获取的，那么将subscription放入上下文，
        // 为了保证在component更新完毕之前被connect的子组件不会更新
        return {
          ...contextValue,
          subscription,
        }
      }, [didStoreComeFromProps, contextValue, subscription])

      // We need to force this wrapper component to re-render whenever a Redux store update
      // causes a change to the calculated child component props (or we caught an error in mapState)
      // 内置reducer，来使组件更新，在checkForUpdates函数中会用到，作为更新机制的核心
      const [[previousStateUpdateResult], forceComponentUpdateDispatch] =
        useReducer(storeStateUpdatesReducer, EMPTY_ARRAY, initStateUpdates)

      // Propagate any mapState/mapDispatch errors upwards
      if (previousStateUpdateResult && previousStateUpdateResult.error) {
        throw previousStateUpdateResult.error
      }

      // Set up refs to coordinate values between the subscription effect and the render logic
      const lastChildProps = useRef()
      const lastWrapperProps = useRef(wrapperProps) // 组件本生来自父组件的props
      const childPropsFromStoreUpdate = useRef() // 来自store的新的props，用于标记来自store的props是否被更新了
      const renderIsScheduled = useRef(false) // 标记更新的时机
      // actualChildProps就是最终要注入到组件中的props，也就是selector的返回值。
      // 一旦执行forceComponentUpdateDispatch， previousStateUpdateResult就会改变
      const actualChildProps = usePureOnlyMemo(() => {
        // Tricky logic here:
        // - This render may have been triggered by a Redux store update that produced new child props
        // - However, we may have gotten new wrapper props after that
        // If we have new child props, and the same wrapper props, we know we should use the new child props as-is.
        // But, if we have new wrapper props, those might change the child props, so we have to recalculate things.
        // So, we'll use the child props from store update only if the wrapper props are the same as last time.
        if (
          childPropsFromStoreUpdate.current &&
          wrapperProps === lastWrapperProps.current
        ) {
          return childPropsFromStoreUpdate.current
        }

        // TODO We're reading the store directly in render() here. Bad idea?
        // This will likely cause Bad Things (TM) to happen in Concurrent Mode.
        // Note that we do this because on renders _not_ caused by store updates, we need the latest store state
        // to determine what the child props should be.
        return childPropsSelector(store.getState(), wrapperProps)
      }, [store, previousStateUpdateResult, wrapperProps])

      // We need this to execute synchronously every time we re-render. However, React warns
      // about useLayoutEffect in SSR, so we try to detect environment and fall back to
      // just useEffect instead to avoid the warning, since neither will run anyway.
      // 没有依赖项，每次重新渲染的时候执行，负责每次检查来自store的数据有没有变化，变化就通知liseners去更新
      useIsomorphicLayoutEffectWithArgs(captureWrapperProps, [
        lastWrapperProps,
        lastChildProps,
        renderIsScheduled,
        wrapperProps,
        actualChildProps,
        childPropsFromStoreUpdate,
        notifyNestedSubs,
      ])

      // Our re-subscribe logic only runs when the store/subscription setup changes
      // 依赖于store, subscription, childPropsSelector。当有变化时，执行effect
      // effect 内部负责定义更新函数checkForUpdates、订阅更新函数，
      // 便于在第一个effect响应store更新的时候，可以将更新函数作为listener执行，
      // 来达到更新页面的目的
      // 重新订阅仅在store内的subscription变化时才会执行。这两个变化了，
      // 也就意味着要重新订阅，因为保证传递最新的数据，所以之前的订阅已经没有意义了

      // subscription 和 childPropsSelector 变化基本取决于store是否变化
      useIsomorphicLayoutEffectWithArgs(
        subscribeUpdates,
        [
          shouldHandleStateChanges,
          store,
          subscription,
          childPropsSelector,
          lastWrapperProps,
          lastChildProps,
          renderIsScheduled,
          childPropsFromStoreUpdate,
          notifyNestedSubs,
          forceComponentUpdateDispatch,
        ],
        [store, subscription, childPropsSelector]
      )

      // Now that all that's done, we can finally try to actually render the child component.
      // We memoize the elements for the rendered child component as an optimization.
      // 注入props 到组件中
      const renderedWrappedComponent = useMemo(
        () => (
          <WrappedComponent
            {...actualChildProps}
            ref={reactReduxForwardedRef}
          />
        ),
        [reactReduxForwardedRef, WrappedComponent, actualChildProps]
      )

      // If React sees the exact same element reference as last time, it bails out of re-rendering
      // that child, same as if it was wrapped in React.memo() or returned false from shouldComponentUpdate.
      const renderedChild = useMemo(() => {
        if (shouldHandleStateChanges) {
          // If this component is subscribed to store updates, we need to pass its own
          // subscription instance down to our descendants. That means rendering the same
          // Context instance, and putting a different value into the context.
          // 如果这个组件订阅了store的更新，就需要把它自己订阅的实例往下传，也就意味这其自身与其
          // 后代组件都会渲染同一个Context实例，只不过可能会向context中放入不同的值

          // 再套一层Provider，将被重写的context放入value。
          // 这是什么意思呢？也就是说，有一个被connect的组件，又嵌套了一个被connect的组件，
          // 保证这两个从context中获取的subscription是同一个，而它们可能都会往context中新增加值，
          // 我加了一个，我的子组件也加了一个。最终的context是所有组件的value的整合，而subscription始终是同一个
          return (
            <ContextToUse.Provider value={overriddenContextValue}>
              {renderedWrappedComponent}
            </ContextToUse.Provider>
          )
        }
        // 依赖于接收到的context，传入的组件，context的value的变化来决定是否重新渲染
        return renderedWrappedComponent
      }, [ContextToUse, renderedWrappedComponent, overriddenContextValue])

      return renderedChild
    }

    // If we're in "pure" mode, ensure our wrapper component only re-renders when incoming props have changed.
    const Connect = pure ? React.memo(ConnectFunction) : ConnectFunction

    Connect.WrappedComponent = WrappedComponent
    Connect.displayName = ConnectFunction.displayName = displayName
    // 如果forwardRef为true，将ref注入到Connect组件，便于获取到组件的DOM实例
    if (forwardRef) {
      const forwarded = React.forwardRef(function forwardConnectRef(
        props,
        ref
      ) {
        return <Connect {...props} reactReduxForwardedRef={ref} />
      })

      forwarded.displayName = displayName
      forwarded.WrappedComponent = WrappedComponent
      return hoistStatics(forwarded, WrappedComponent)
    }
    // 保留组件的静态方法
    return hoistStatics(Connect, WrappedComponent)
  }
}
