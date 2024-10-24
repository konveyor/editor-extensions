package com.redhat.coolstore.service;

import java.util.logging.Logger;
import jakarta.enterprise.context.ApplicationScoped;
import javax.annotation.Resource;
import javax.inject.Inject;
import javax.jms.JMSContext;
import javax.jms.Topic;

import com.redhat.coolstore.model.ShoppingCart;
import com.redhat.coolstore.utils.Transformers;

@ApplicationScoped
public class ShoppingCartOrderProcessor  {

    @Inject
    Logger log;


    @Inject
    private transient JMSContext context;

    @Resource(lookup = "java:/topic/orders")
    private Topic ordersTopic;

    
  
    public void  process(ShoppingCart cart) {
        log.info("Sending order from processor: ");
        context.createProducer().send(ordersTopic, Transformers.shoppingCartToJson(cart));
    }



}
